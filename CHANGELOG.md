# Changelog

## 0.5.12

- Show explicit rebooting/shutting-down messages after confirmed Pi Controller
  power actions and disable the power buttons while the action is pending.

## 0.5.11

- Show Piper installer stdout/stderr in the Audio Support card while the action
  is running and after it finishes.
- Fail the bundled Piper installer early with a clear message when the Signal K
  service cannot use `sudo` non-interactively, instead of leaving the webapp
  stuck on a generic running status.
- Add a timeout guard for support installer actions.

## 0.5.10

- Install FFmpeg as part of the confirmed Piper installer action so AJRM Marine
  Audio has the full server-side MP3 render chain after one Pi Controller
  support action.

## 0.5.9

- Add a configured SD-card backup USB target and confirmed `rpi-clone`
  action, including target detection, boot-device protection, and recent
  command output in the webapp.

## 0.5.5

- Fix the Piper installer cleanup trap so a successful install is not reported
  as failed after the temporary directory is removed.

## 0.5.4

- Make the bundled Piper installer use the latest GitHub Piper release by
  default and resolve the correct Linux ARM64 archive from the release assets.

## 0.5.3

- Add Signal K AppStore utility category metadata.

## 0.5.2

- Update the public GitHub install command to use HTTPS for fresh Pi installs.

## 0.5.1

- Rename telemetry capture description to AJRM Marine Logger/Capture/Snapshot naming.

## 0.5.0

- Initial public beta release as AJRM Marine Pi Controller.
