export async function captureBrowserScreen(): Promise<string> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen sharing requires HTTPS or localhost in a supported browser.");
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const video = document.createElement("video");
  try {
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Screen capture timed out.")), 5000);
      video.requestVideoFrameCallback(() => { clearTimeout(timeout); resolve(); });
    });
    const scale = Math.min(1, 1600 / video.videoWidth, 1000 / video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Screen capture is unavailable.");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
  } finally {
    stream.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
}
