import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { Jimp } = require("jimp");
const jsQR = require("jsqr");

export async function decodeQRFromImage(buffer) {
  return new Promise((resolve, reject) => {
    Jimp.read(buffer)
      .then((image) => {
        const imageData = new Uint8ClampedArray(image.bitmap.data);
        const code = jsQR(imageData, image.bitmap.width, image.bitmap.height);
        
        if (code) {
          resolve(code.data);
        } else {
          console.error("QR Code not found in image");
          reject(new Error("QR Code not found"));
        }
      })
      .catch((err) => {
        console.error("Jimp read error:", err);
        reject(err);
      });
  });
}
