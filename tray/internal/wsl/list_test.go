package wsl

import (
	"testing"
	"unicode/utf16"
)

// toUTF16LE encodes text the way wsl.exe writes it to the console.
func toUTF16LE(text string, bom bool) []byte {
	units := utf16.Encode([]rune(text))
	out := make([]byte, 0, len(units)*2+2)
	if bom {
		out = append(out, 0xFF, 0xFE)
	}
	for _, u := range units {
		out = append(out, byte(u), byte(u>>8))
	}
	return out
}

func TestDecodeConsoleUTF16(t *testing.T) {
	const text = "  NAME      STATE           VERSION\r\n* Ubuntu    Stopped         2\r\n"

	for _, withBOM := range []bool{true, false} {
		got := decodeConsole(toUTF16LE(text, withBOM))
		if got != text {
			t.Errorf("decodeConsole(bom=%v) = %q, want %q", withBOM, got, text)
		}
	}
}

func TestDecodeConsoleUTF8(t *testing.T) {
	const text = "plain ascii output\n"
	if got := decodeConsole([]byte(text)); got != text {
		t.Errorf("decodeConsole = %q, want %q", got, text)
	}
}

func TestParseList(t *testing.T) {
	tests := []struct {
		name string
		text string
		want []Distro
	}{
		{
			name: "default distro",
			text: "  NAME      STATE           VERSION\n* Ubuntu    Stopped         2\n",
			want: []Distro{{Name: "Ubuntu", State: "Stopped", Version: 2, Default: true}},
		},
		{
			name: "several distros",
			text: "  NAME              STATE           VERSION\n" +
				"* Ubuntu            Running         2\n" +
				"  docker-desktop    Stopped         2\n",
			want: []Distro{
				{Name: "Ubuntu", State: "Running", Version: 2, Default: true},
				{Name: "docker-desktop", State: "Stopped", Version: 2},
			},
		},
		{
			// The header is localized; it must be skipped by position, not by
			// matching the English column names.
			name: "localized header",
			text: "  名前        状態            バージョン\n* Ubuntu      Running         2\n",
			want: []Distro{{Name: "Ubuntu", State: "Running", Version: 2, Default: true}},
		},
		{
			name: "leading blank line",
			text: "\n  NAME      STATE     VERSION\n* Ubuntu    Running   2\n",
			want: []Distro{{Name: "Ubuntu", State: "Running", Version: 2, Default: true}},
		},
		{
			name: "no distros",
			text: "Windows Subsystem for Linux has no installed distributions.\n",
			want: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseList(tt.text)
			if len(got) != len(tt.want) {
				t.Fatalf("parseList returned %d rows, want %d: %+v", len(got), len(tt.want), got)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("row %d = %+v, want %+v", i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestDistroRunning(t *testing.T) {
	if !(Distro{State: "Running"}).Running() {
		t.Error(`State "Running" should report running`)
	}
	if !(Distro{State: "RUNNING"}).Running() {
		t.Error("state matching should be case-insensitive")
	}
	if (Distro{State: "Stopped"}).Running() {
		t.Error(`State "Stopped" should not report running`)
	}
}

func TestFind(t *testing.T) {
	distros := []Distro{{Name: "docker-desktop"}, {Name: "Ubuntu", Version: 2}}
	if got, ok := Find(distros, "ubuntu"); !ok || got.Version != 2 {
		t.Errorf("Find should match case-insensitively, got %+v ok=%v", got, ok)
	}
	if _, ok := Find(distros, "Debian"); ok {
		t.Error("Find should not match a missing distro")
	}
}
