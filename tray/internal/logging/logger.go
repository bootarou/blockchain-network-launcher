// Package logging writes the tray application log to %LOCALAPPDATA%\BNL\tray.log.
//
// The tray application has no log window, so this file is the only place a user
// can see what happened during a start or stop. It is kept next to install.log
// (written by BNL-Setup) so both are available when troubleshooting.
package logging

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	maxSize     = 1 << 20 // rotate at 1 MB
	maxBackups  = 3
	logFileName = "tray.log"
)

// Logger is a small rotating file logger. It never returns write errors to the
// caller: logging must not be able to break the application.
type Logger struct {
	mu   sync.Mutex
	path string
	file *os.File
	size int64
}

// Dir returns %LOCALAPPDATA%\BNL, creating it if needed.
func Dir() (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		var err error
		base, err = os.UserCacheDir()
		if err != nil {
			return "", err
		}
	}
	dir := filepath.Join(base, "BNL")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// New opens the log file for appending.
func New() (*Logger, error) {
	dir, err := Dir()
	if err != nil {
		return nil, err
	}
	l := &Logger{path: filepath.Join(dir, logFileName)}
	if err := l.open(); err != nil {
		return nil, err
	}
	return l, nil
}

func (l *Logger) open() error {
	f, err := os.OpenFile(l.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	l.file = f
	if info, err := f.Stat(); err == nil {
		l.size = info.Size()
	}
	return nil
}

// Path returns the absolute path of the current log file.
func (l *Logger) Path() string { return l.path }

// Close flushes and closes the log file.
func (l *Logger) Close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file != nil {
		_ = l.file.Close()
		l.file = nil
	}
}

// Infof records an informational line.
func (l *Logger) Infof(format string, args ...any) { l.write("INFO", format, args...) }

// Warnf records a warning line.
func (l *Logger) Warnf(format string, args ...any) { l.write("WARN", format, args...) }

// Errorf records an error line.
func (l *Logger) Errorf(format string, args ...any) { l.write("ERROR", format, args...) }

func (l *Logger) write(level, format string, args ...any) {
	line := fmt.Sprintf("%s [%s] %s\n",
		time.Now().Format("2006-01-02 15:04:05"), level, fmt.Sprintf(format, args...))

	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file == nil {
		return
	}
	if l.size+int64(len(line)) > maxSize {
		l.rotateLocked()
	}
	n, err := l.file.WriteString(line)
	if err == nil {
		l.size += int64(n)
	}
}

func (l *Logger) rotateLocked() {
	_ = l.file.Close()
	l.file = nil

	// tray.log.2 -> tray.log.3, tray.log.1 -> tray.log.2, tray.log -> tray.log.1
	for i := maxBackups - 1; i >= 1; i-- {
		_ = os.Rename(fmt.Sprintf("%s.%d", l.path, i), fmt.Sprintf("%s.%d", l.path, i+1))
	}
	_ = os.Rename(l.path, l.path+".1")

	l.size = 0
	if err := l.open(); err != nil {
		l.file = nil
	}
}
