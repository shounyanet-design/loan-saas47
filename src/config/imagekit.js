const ImageKit = require('imagekit');

let imagekit = null;

try {
  imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY || 'test_dummy_public_key',
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY || 'test_dummy_private_key',
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/dummy',
  });
} catch (err) {
  console.warn('⚠️ ImageKit initialization error:', err.message);
}

module.exports = imagekit;
