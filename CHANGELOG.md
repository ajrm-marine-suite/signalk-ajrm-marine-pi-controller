# Changelog

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
