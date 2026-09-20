package tray

import (
	"encoding/binary"
	"testing"

	"github.com/bootarou/bnl-tray/internal/bnl"
)

// A malformed .ico is rejected silently by LoadImage, leaving the tray with no
// icon at all, so the container structure is checked here.
func TestEncodeICOStructure(t *testing.T) {
	data := icon(iconRunning)

	if len(data) < 6 {
		t.Fatalf("icon is only %d bytes", len(data))
	}
	if reserved := binary.LittleEndian.Uint16(data[0:2]); reserved != 0 {
		t.Errorf("reserved = %d, want 0", reserved)
	}
	if kind := binary.LittleEndian.Uint16(data[2:4]); kind != 1 {
		t.Errorf("type = %d, want 1 (icon)", kind)
	}
	count := int(binary.LittleEndian.Uint16(data[4:6]))
	if count != len(iconSizes) {
		t.Fatalf("image count = %d, want %d", count, len(iconSizes))
	}

	for i, size := range iconSizes {
		entry := data[6+16*i : 6+16*(i+1)]
		if int(entry[0]) != size || int(entry[1]) != size {
			t.Errorf("entry %d is %dx%d, want %dx%d", i, entry[0], entry[1], size, size)
		}
		if bits := binary.LittleEndian.Uint16(entry[6:8]); bits != 32 {
			t.Errorf("entry %d bit count = %d, want 32", i, bits)
		}

		length := binary.LittleEndian.Uint32(entry[8:12])
		offset := binary.LittleEndian.Uint32(entry[12:16])
		if int(offset+length) > len(data) {
			t.Fatalf("entry %d points past the end of the file", i)
		}

		// BITMAPINFOHEADER: height is doubled to cover the AND mask.
		dib := data[offset : offset+length]
		if header := binary.LittleEndian.Uint32(dib[0:4]); header != 40 {
			t.Errorf("entry %d header size = %d, want 40", i, header)
		}
		if width := int32(binary.LittleEndian.Uint32(dib[4:8])); int(width) != size {
			t.Errorf("entry %d DIB width = %d, want %d", i, width, size)
		}
		if height := int32(binary.LittleEndian.Uint32(dib[8:12])); int(height) != size*2 {
			t.Errorf("entry %d DIB height = %d, want %d", i, height, size*2)
		}
	}
}

func TestIconsAreDistinct(t *testing.T) {
	kinds := []iconKind{iconUnknown, iconRunning, iconStopped, iconNotInstalled, iconBusy, iconBusyAlt, iconError}
	seen := map[string]iconKind{}
	for _, kind := range kinds {
		key := string(icon(kind))
		if other, ok := seen[key]; ok {
			t.Errorf("icons %d and %d are identical", other, kind)
		}
		seen[key] = kind
	}
}

func TestIconForState(t *testing.T) {
	tests := []struct {
		state bnl.State
		want  iconKind
	}{
		{bnl.StateRunning, iconRunning},
		{bnl.StateStopped, iconStopped},
		{bnl.StateNotInstalled, iconNotInstalled},
		{bnl.StateWslMissing, iconNotInstalled},
		{bnl.StateStarting, iconBusy},
		{bnl.StateStopping, iconBusy},
		{bnl.StateError, iconError},
		{bnl.StateUnknown, iconUnknown},
	}
	for _, tt := range tests {
		if got := iconForState(tt.state); got != tt.want {
			t.Errorf("iconForState(%v) = %v, want %v", tt.state, got, tt.want)
		}
	}
}
