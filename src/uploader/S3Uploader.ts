import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Logger } from 'edumeet-common';
import { readFile } from 'fs/promises';
import { S3Config } from './samplesUploadUri';
import { Uploader, UploadOptions } from './Uploader';

const logger = new Logger('S3Uploader');

/**
 * Uploads to S3 or any S3-compatible store.
 *
 * Owns the bucket and the optional key prefix from the parsed URI, so callers
 * pass plain relative keys and never have to know about either.
 */
export class S3Uploader implements Uploader {
	public readonly stats = {
		ongoingUploads: 0,
		completedUploads: 0,
		failedUploads: 0,
	};

	public readonly deleteAfterUpload: boolean;

	private readonly client: S3Client;
	private readonly bucket: string;
	private readonly keyPrefix?: string;

	/**
	 * @param config resolved by `parseSamplesUploadUri()`
	 * @param client pre-built client, primarily so tests can inject a stub
	 */
	public constructor(config: S3Config, client?: S3Client) {
		const { bucket, keyPrefix, region, endpoint, forcePathStyle, credentials, maxAttempts } = config;

		this.bucket = bucket;
		this.keyPrefix = keyPrefix;
		this.client = client ?? new S3Client({
			...(region && { region }),
			...(endpoint && { endpoint }),
			forcePathStyle,
			...(credentials && { credentials }),
			...(maxAttempts && { maxAttempts }),
		});
		this.deleteAfterUpload = config.deleteAfterUpload ?? false;
	}

	public async upload({ key, body, sourcePath, contentType }: UploadOptions): Promise<void> {
		const targetKey = this.buildKey(key);

		this.stats.ongoingUploads++;

		try {
			const payload = sourcePath !== undefined ? await readFile(sourcePath) : body;

			if (payload === undefined) {
				throw new Error(`upload() neither body nor sourcePath given [key: ${targetKey}]`);
			}

			await this.client.send(new PutObjectCommand({
				Bucket: this.bucket,
				Key: targetKey,
				Body: payload,
				ContentType: contentType,
			}));

			logger.debug('upload() uploaded [key: %s]', targetKey);
			this.stats.completedUploads++;
		} catch (error) {
			this.stats.failedUploads++;

			throw error;
		} finally {
			this.stats.ongoingUploads--;
		}
	}

	/** Prefix a logical key with the optional key prefix from the URI. */
	private buildKey(key: string): string {
		return this.keyPrefix ? `${this.keyPrefix}/${key}` : key;
	}
}
