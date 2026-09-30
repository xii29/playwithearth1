# DoodleFace local MediaPipe assets

These files are served by Vite as static local assets for DoodleFace only:

- `wasm/`: MediaPipe Tasks Vision WASM loaders and binaries
- `models/face_landmarker.task`: FaceLandmarker model
- `models/hand_landmarker.task`: HandLandmarker model

They keep the local two-player game independent of runtime model and WASM network requests.
