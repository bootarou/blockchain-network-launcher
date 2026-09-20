package bnl

// Failure is an operation failure with text that can be shown to the user
// directly. The set mirrors the exit codes of BNL-Start.bat so the tray reports
// exactly the conditions the batch scripts already distinguish.
type Failure struct {
	// Message is the notification body.
	Message string
	// Hint is the follow-up action, written to the log.
	Hint string
	// Cause is the underlying error, if any.
	Cause error
}

func (f *Failure) Error() string { return f.Message }

func (f *Failure) Unwrap() error { return f.Cause }

// withCause returns a copy carrying the underlying error, so the package-level
// sentinels stay comparable with errors.Is.
func (f *Failure) withCause(err error) *Failure {
	clone := *f
	clone.Cause = err
	return &clone
}

// Is lets errors.Is match a wrapped copy against its sentinel.
func (f *Failure) Is(target error) bool {
	other, ok := target.(*Failure)
	return ok && other.Message == f.Message
}

// Failures corresponding to BNL-Start.bat exit codes 1 and 10-14.
var (
	ErrWslStart = &Failure{
		Message: "Ubuntu could not be started.",
		Hint:    "Check WSL with: wsl -l -v",
	}
	ErrNotInstalled = &Failure{
		Message: "BNL is not installed.",
		Hint:    "Run BNL-Setup.bat first (Open install folder).",
	}
	ErrKeepalive = &Failure{
		Message: "WSL keepalive could not be started.",
		Hint:    "See tray.log for the failing command.",
	}
	ErrDockerTimeout = &Failure{
		Message: "Docker did not start within 30 seconds.",
		Hint:    "Check with: wsl -d Ubuntu -u root -- docker info",
	}
	ErrComposeUp = &Failure{
		Message: "BNL manager could not be started.",
		Hint:    "The last 80 log lines were written to tray.log.",
	}
	ErrWebUnreachable = &Failure{
		Message: "BNL started, but the Web UI is not reachable.",
		Hint:    "Check the address manually; see tray.log.",
	}
	ErrComposeStop = &Failure{
		Message: "BNL manager could not be stopped.",
		Hint:    "See tray.log for the failing command.",
	}
)
