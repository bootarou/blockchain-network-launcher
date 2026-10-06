package wsl

import (
	"bytes"
	"context"
	"strconv"
	"strings"

	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// Distro is one row of `wsl -l -v`.
type Distro struct {
	Name    string
	State   string
	Version int
	Default bool
}

// Running reports whether the distribution's VM is up.
//
// The state column is matched case-insensitively because its casing has varied
// between Windows builds.
func (d Distro) Running() bool {
	return strings.EqualFold(d.State, "Running")
}

// List returns the installed distributions.
//
// This is the only probe that is safe to run continuously: unlike
// `wsl -d <name> -- <cmd>`, listing does not start a stopped VM.
func (r *Runner) List(ctx context.Context) ([]Distro, error) {
	out, err := r.Output(ctx, "-l", "-v")
	distros := parseList(decodeConsole(out))
	if len(distros) == 0 {
		if err != nil {
			return nil, err
		}
		return nil, ErrNoDistros
	}
	return distros, nil
}

// Find returns the named distribution, if present.
func Find(distros []Distro, name string) (Distro, bool) {
	for _, d := range distros {
		if strings.EqualFold(d.Name, name) {
			return d, true
		}
	}
	return Distro{}, false
}

// decodeConsole converts wsl.exe console output to UTF-8.
//
// `wsl -l -v` writes UTF-16LE. Reading it as UTF-8 yields a string full of NUL
// bytes that matches nothing, which would leave the tray permanently in the
// Unknown state — so the encoding is detected rather than assumed.
func decodeConsole(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	if !looksUTF16LE(b) {
		return string(b)
	}
	dec := unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewDecoder()
	decoded, _, err := transform.Bytes(dec, b)
	if err != nil {
		// Fall back to dropping the NUL padding rather than losing the output.
		return string(bytes.ReplaceAll(b, []byte{0}, nil))
	}
	return string(decoded)
}

func looksUTF16LE(b []byte) bool {
	if len(b) >= 2 && b[0] == 0xFF && b[1] == 0xFE {
		return true
	}
	// ASCII text encoded as UTF-16LE has a NUL in every second byte.
	limit := min(len(b), 64)
	nuls := 0
	for i := 1; i < limit; i += 2 {
		if b[i] == 0 {
			nuls++
		}
	}
	return nuls*2 >= limit/2
}

// parseList reads the rows of `wsl -l -v`, skipping the header.
//
// The header is localized (e.g. "名前  状態  バージョン" on Japanese Windows), so
// it is identified by position rather than by content.
func parseList(text string) []Distro {
	var distros []Distro
	headerSeen := false
	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(strings.TrimRight(line, "\r"))
		if trimmed == "" {
			continue
		}
		if !headerSeen {
			headerSeen = true // first non-empty line is the column header
			continue
		}

		isDefault := strings.HasPrefix(trimmed, "*")
		fields := strings.Fields(strings.TrimPrefix(trimmed, "*"))
		if len(fields) < 3 {
			continue
		}
		version, err := strconv.Atoi(fields[len(fields)-1])
		if err != nil {
			continue
		}
		distros = append(distros, Distro{
			Name:    fields[0],
			State:   fields[len(fields)-2],
			Version: version,
			Default: isDefault,
		})
	}
	return distros
}
