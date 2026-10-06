// Package wsl runs commands inside the WSL2 distribution that hosts BNL.
//
// Every command is launched with the console window suppressed: a resident tray
// application must never flash a black window while polling.
package wsl

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"strings"

	"github.com/bootarou/bnl-tray/internal/winproc"
)

// DefaultDistro is the distribution BNL is installed into (see the lifecycle spec).
const DefaultDistro = "Ubuntu"

// Runner executes wsl.exe.
type Runner struct {
	Distro string
	// Log, when set, receives every command line and its output. Used to make
	// start/stop failures reconstructable from tray.log.
	Log func(format string, args ...any)
}

// NewRunner returns a Runner for the given distribution, defaulting to Ubuntu.
func NewRunner(distro string) *Runner {
	if distro == "" {
		distro = DefaultDistro
	}
	return &Runner{Distro: distro}
}

func (r *Runner) logf(format string, args ...any) {
	if r.Log != nil {
		r.Log(format, args...)
	}
}

// Output runs wsl.exe with the given arguments and returns its combined output.
// The bytes are returned undecoded: `wsl -l -v` emits UTF-16LE while command
// output from inside the distribution is UTF-8.
func (r *Runner) Output(ctx context.Context, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "wsl.exe", args...)
	winproc.Hide(cmd)

	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()
	if err != nil && ctx.Err() != nil {
		err = ctx.Err()
	}
	return buf.Bytes(), err
}

// Bash runs a shell script inside the distribution as root and returns its
// output as UTF-8 text.
//
// The script is passed as a single argument, so it may contain single quotes
// (bash parses them); avoid double quotes to keep Windows command-line escaping
// predictable.
func (r *Runner) Bash(ctx context.Context, script string) (string, error) {
	out, err := r.Output(ctx, "-d", r.Distro, "-u", "root", "--", "bash", "-lc", script)
	text := strings.TrimRight(string(out), "\r\n")
	if err != nil {
		r.logf("wsl bash failed: %v | script: %s | output: %s", err, script, text)
	}
	return text, err
}

// Ping starts the distribution and verifies it responds. It is the equivalent of
// step 1 of BNL-Start.bat.
func (r *Runner) Ping(ctx context.Context) error {
	_, err := r.Output(ctx, "-d", r.Distro, "-u", "root", "--", "true")
	return err
}

// ErrNoDistros reports that wsl.exe listed no distributions at all.
var ErrNoDistros = errors.New("wsl: no distributions installed")
