const { BlobServiceClient } = require('@azure/storage-blob');
const path = require('path');
const crypto = require('crypto');

/**
 * Uploads an asset to Azure Blob Storage and returns its public URL
 * @param {Buffer} buffer The file buffer
 * @param {string} originalFilename The original filename
 * @param {string} mimetype The MIME type of the file
 * @returns {Promise<string>} The public URL of the uploaded asset
 */
async function uploadAsset(buffer, originalFilename, mimetype) {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'assets';

    if (!connectionString) {
        throw new Error('AZURE_STORAGE_CONNECTION_STRING is not defined');
    }

    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient(containerName);

    // Create container if it doesn't exist
    await containerClient.createIfNotExists({
        access: 'blob' // Allow public read access for blobs
    });

    // Generate a unique filename to prevent overwrites
    const ext = path.extname(originalFilename);
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const safeName = path.basename(originalFilename, ext).replace(/[^a-zA-Z0-9-]/g, '');
    const uniqueFilename = `${safeName}-${uniqueId}${ext}`;

    const blockBlobClient = containerClient.getBlockBlobClient(uniqueFilename);

    await blockBlobClient.uploadData(buffer, {
        blobHTTPHeaders: { blobContentType: mimetype }
    });

    return blockBlobClient.url;
}

module.exports = {
    uploadAsset
};
