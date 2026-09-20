package tray

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"math"
	"sync"

	"github.com/bootarou/bnl-tray/internal/bnl"
)

// Tray icons are drawn at runtime rather than shipped as .ico files: the whole
// icon set is a coloured dot in six variations, and generating it keeps the
// repository free of binary assets.
//
// Windows picks the closest size from the .ico, so each icon carries the DPI
// sizes a taskbar may ask for.
var iconSizes = []int{16, 20, 24, 32, 48}

type iconKind int

const (
	iconUnknown iconKind = iota
	iconRunning
	iconStopped
	iconNotInstalled
	iconBusy
	iconBusyAlt
	iconError
)

var (
	colorRunning = color.RGBA{R: 0x22, G: 0xC5, B: 0x5E, A: 0xFF} // green
	colorIdle    = color.RGBA{R: 0x9C, G: 0xA3, B: 0xAF, A: 0xFF} // grey
	colorBusy    = color.RGBA{R: 0xF5, G: 0x9E, B: 0x0B, A: 0xFF} // amber
	colorError   = color.RGBA{R: 0xEF, G: 0x44, B: 0x44, A: 0xFF} // red
)

var (
	iconMu    sync.Mutex
	iconCache = map[iconKind][]byte{}
)

// iconForState maps a display state to its icon.
func iconForState(state bnl.State) iconKind {
	switch state {
	case bnl.StateRunning:
		return iconRunning
	case bnl.StateStopped:
		return iconStopped
	case bnl.StateNotInstalled, bnl.StateWslMissing:
		return iconNotInstalled
	case bnl.StateStarting, bnl.StateStopping:
		return iconBusy
	case bnl.StateError:
		return iconError
	default:
		return iconUnknown
	}
}

// icon returns the .ico bytes for a kind, building them once.
func icon(kind iconKind) []byte {
	iconMu.Lock()
	defer iconMu.Unlock()
	if data, ok := iconCache[kind]; ok {
		return data
	}

	var frames []*image.RGBA
	for _, size := range iconSizes {
		frames = append(frames, drawDot(size, kind))
	}
	data := encodeICO(frames)
	iconCache[kind] = data
	return data
}

// drawDot renders one size of an icon.
func drawDot(size int, kind iconKind) *image.RGBA {
	var (
		fill   color.RGBA
		hollow bool
		dashed bool
		badge  bool
	)
	switch kind {
	case iconRunning:
		fill = colorRunning
	case iconStopped:
		fill = colorIdle
	case iconNotInstalled:
		// Dashed, so "not installed" is distinguishable at 16px from the plain
		// ring used while the state is still being determined.
		fill, hollow, dashed = colorIdle, true, true
	case iconBusy:
		fill = colorBusy
	case iconBusyAlt:
		fill, hollow = colorBusy, true
	case iconError:
		fill, badge = colorError, true
	default:
		fill, hollow = colorIdle, true
	}

	// Render at 4x and box-filter down, so the circle edge is smooth at 16px.
	const ss = 4
	hi := size * ss
	super := image.NewRGBA(image.Rect(0, 0, hi, hi))

	center := float64(hi) / 2
	radius := float64(hi) * 0.42
	ring := float64(hi) * 0.13
	dark := darken(fill)

	for y := 0; y < hi; y++ {
		for x := 0; x < hi; x++ {
			dx := float64(x) + 0.5 - center
			dy := float64(y) + 0.5 - center
			dist := dx*dx + dy*dy

			switch {
			case dist > radius*radius:
				continue
			case hollow && dist < (radius-ring)*(radius-ring):
				continue
			case dashed && inGap(dx, dy):
				continue
			case dist > (radius-float64(hi)*0.06)*(radius-float64(hi)*0.06):
				// Outer rim in a darker shade for contrast on light taskbars.
				super.SetRGBA(x, y, dark)
			default:
				super.SetRGBA(x, y, fill)
			}
		}
	}

	if badge {
		drawExclamation(super, hi)
	}
	return downsample(super, size, ss)
}

// dashSegments is the number of on/off segments around a dashed ring.
const dashSegments = 12

// inGap reports whether a point falls in the empty part of a dashed ring.
func inGap(dx, dy float64) bool {
	angle := math.Atan2(dy, dx) + math.Pi // 0..2π
	segment := int(angle / (2 * math.Pi / dashSegments))
	return segment%2 == 1
}

// drawExclamation marks the error icon with a white "!".
func drawExclamation(img *image.RGBA, size int) {
	white := color.RGBA{R: 0xFF, G: 0xFF, B: 0xFF, A: 0xFF}
	fillRect(img, size, 0.45, 0.26, 0.55, 0.58, white) // stem
	fillRect(img, size, 0.45, 0.64, 0.55, 0.76, white) // dot
}

// fillRect fills a rectangle given in fractions of the icon size.
func fillRect(img *image.RGBA, size int, x0, y0, x1, y1 float64, c color.RGBA) {
	for y := int(y0 * float64(size)); y < int(y1*float64(size)); y++ {
		for x := int(x0 * float64(size)); x < int(x1*float64(size)); x++ {
			img.SetRGBA(x, y, c)
		}
	}
}

// downsample box-filters the supersampled image, averaging alpha as well so
// edges fade out instead of stair-stepping.
func downsample(src *image.RGBA, size, factor int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	samples := factor * factor

	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			var r, g, b, a int
			for sy := 0; sy < factor; sy++ {
				for sx := 0; sx < factor; sx++ {
					px := src.RGBAAt(x*factor+sx, y*factor+sy)
					r += int(px.R)
					g += int(px.G)
					b += int(px.B)
					a += int(px.A)
				}
			}
			dst.SetRGBA(x, y, color.RGBA{
				R: uint8(r / samples),
				G: uint8(g / samples),
				B: uint8(b / samples),
				A: uint8(a / samples),
			})
		}
	}
	return dst
}

func darken(c color.RGBA) color.RGBA {
	const factor = 0.72
	return color.RGBA{
		R: uint8(float64(c.R) * factor),
		G: uint8(float64(c.G) * factor),
		B: uint8(float64(c.B) * factor),
		A: c.A,
	}
}

// encodeICO packs the frames into an .ico file.
//
// systray writes these bytes to a temp file and hands it to LoadImage, which
// only accepts a real .ico - so the images are stored as 32-bit BMP (DIB)
// entries, the format every Windows version accepts.
func encodeICO(frames []*image.RGBA) []byte {
	buf := new(bytes.Buffer)

	blobs := make([][]byte, len(frames))
	for i, frame := range frames {
		blobs[i] = encodeDIB(frame)
	}

	// ICONDIR
	_ = binary.Write(buf, binary.LittleEndian, uint16(0)) // reserved
	_ = binary.Write(buf, binary.LittleEndian, uint16(1)) // type: icon
	_ = binary.Write(buf, binary.LittleEndian, uint16(len(frames)))

	offset := 6 + 16*len(frames)
	for i, frame := range frames {
		size := frame.Bounds().Dx()
		buf.WriteByte(byte(size)) // width  (0 would mean 256)
		buf.WriteByte(byte(size)) // height
		buf.WriteByte(0)          // palette colours
		buf.WriteByte(0)          // reserved
		_ = binary.Write(buf, binary.LittleEndian, uint16(1))
		_ = binary.Write(buf, binary.LittleEndian, uint16(32))
		_ = binary.Write(buf, binary.LittleEndian, uint32(len(blobs[i])))
		_ = binary.Write(buf, binary.LittleEndian, uint32(offset))
		offset += len(blobs[i])
	}
	for _, blob := range blobs {
		buf.Write(blob)
	}
	return buf.Bytes()
}

// encodeDIB writes a BITMAPINFOHEADER, bottom-up BGRA pixels and an empty AND
// mask, which is what an .ico entry expects.
func encodeDIB(img *image.RGBA) []byte {
	size := img.Bounds().Dx()
	maskRow := ((size + 31) / 32) * 4
	maskSize := maskRow * size
	pixelSize := size * size * 4

	buf := new(bytes.Buffer)
	_ = binary.Write(buf, binary.LittleEndian, uint32(40))    // biSize
	_ = binary.Write(buf, binary.LittleEndian, int32(size))   // biWidth
	_ = binary.Write(buf, binary.LittleEndian, int32(size*2)) // biHeight: XOR + AND
	_ = binary.Write(buf, binary.LittleEndian, uint16(1))     // biPlanes
	_ = binary.Write(buf, binary.LittleEndian, uint16(32))    // biBitCount
	_ = binary.Write(buf, binary.LittleEndian, uint32(0))     // biCompression: BI_RGB
	_ = binary.Write(buf, binary.LittleEndian, uint32(pixelSize+maskSize))
	_ = binary.Write(buf, binary.LittleEndian, int32(0))  // biXPelsPerMeter
	_ = binary.Write(buf, binary.LittleEndian, int32(0))  // biYPelsPerMeter
	_ = binary.Write(buf, binary.LittleEndian, uint32(0)) // biClrUsed
	_ = binary.Write(buf, binary.LittleEndian, uint32(0)) // biClrImportant

	for y := size - 1; y >= 0; y-- { // bottom-up
		for x := 0; x < size; x++ {
			px := img.RGBAAt(x, y)
			buf.Write([]byte{px.B, px.G, px.R, px.A})
		}
	}
	buf.Write(make([]byte, maskSize)) // AND mask: unused with an alpha channel
	return buf.Bytes()
}
