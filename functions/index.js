'use strict';

const functions = require('firebase-functions');
const mkdirp = require('mkdirp');
const admin = require('firebase-admin');
admin.initializeApp();
const path = require('path');
const os = require('os');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpeg_static = require('ffmpeg-static');


// Thumbnail prefix added to file names.
const THUMB_PREFIX = 'thumb_';

function promisifyCommand(command) {
  return new Promise((resolve, reject) => {
    command.on('end', resolve).on('error', reject).run();
  });
}

/**
 * When an mp4 video is uploaded in the Storage bucket We generate a gif thumbnail automatically using
 * ffmpeg.
 * After the thumbnail has been generated and uploaded to Cloud Storage,
 * we write the public URL to the Firebase Realtime Database.
 */
exports.generateThumbnail = functions.storage.object().onFinalize(async (object) => {
  // File and directory paths.
  const filePath = object.name;
  const contentType = object.contentType; // This is the video MIME type
  const fileDir = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const fileNameNoExtension = path.parse(fileName).name;

  const thumbFilePath = path.normalize(path.join(fileDir, `${THUMB_PREFIX}${fileNameNoExtension}.gif`));
  const tempLocalFile = path.join(os.tmpdir(), filePath);
  const tempLocalDir = path.dirname(tempLocalFile);
  const tempLocalThumbFile = path.join(os.tmpdir(), thumbFilePath);

  // Exit if this is triggered on a file that is not an mp4 video.
  if (!contentType.startsWith('video/mp4')) {
    return console.log('This is not an mp4 video.');
  }

  // Exit if the image is already a thumbnail.
  if (fileName.startsWith(THUMB_PREFIX)) {
    return console.log('Already a Thumbnail.');
  }

  // Cloud Storage files.
  const bucket = admin.storage().bucket(object.bucket);
  const file = bucket.file(filePath);
  const thumbFile = bucket.file(thumbFilePath);
  const metadata = {
    contentType: contentType,
    // To enable Client-side caching you can set the Cache-Control headers here. Uncomment below.
    // 'Cache-Control': 'public,max-age=3600',
  };
  
  // Create the temp directory where the storage file will be downloaded.
  await mkdirp(tempLocalDir)
  // Download file from bucket.
  await file.download({destination: tempLocalFile});
  console.log('The file has been downloaded to', tempLocalFile);
  
  // Generate a gif using ffmpeg.
  var cmd =  ffmpeg(tempLocalFile)
  .setFfmpegPath(ffmpeg_static)
  .outputOption("-vf", "scale=240:-1:flags=lanczos,fps=5")
  .on('error', err => {
    console.error(err);
  })
  .output(tempLocalThumbFile);

  await promisifyCommand(cmd);
  console.log('Output gif created at', tempLocalThumbFile);
  // Uploading the audio.
  await bucket.upload(tempLocalThumbFile, {destination: thumbFilePath});
  console.log('Output gif uploaded to', thumbFilePath);

  // Once the gif has been uploaded delete the local file to free up disk space.
  fs.unlinkSync(tempLocalFile);
  fs.unlinkSync(tempLocalThumbFile);

  return console.log('Temporary files removed.', tempLocalThumbFile);

});
