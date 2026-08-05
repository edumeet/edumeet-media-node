import { Logger } from 'edumeet-common';
import { readFile } from 'fs/promises';
import { S3Config } from './samplesUploadUri';
import { Uploader, UploadOptions } from './Uploader';

import type { S3Client, S3ClientConfig } from '@aws-sdk/client-s3';

const logger = new Logger('S3Uploader');

type S3Module = typeof import('@aws-sdk/client-s3');

type S3Sdk = {
	client: S3Client;
	PutObjectCommand: S3Module['PutObjectCommand'];
};

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

	private readonly bucket: string;
	private readonly keyPrefix?: string;
	private readonly clientConfig: S3ClientConfig;
	private readonly injectedClient?: S3Client;

	/** In-flight or settled SDK load; see `ensureSdk()`. */
	private sdk?: Promise<S3Sdk>;

	/** Set once `ensureSdk()` resolves. Undefined before the first upload. */
	private client?: S3Client;

	/**
	 * @param config resolved by `parseSamplesUploadUri()`
	 * @param client pre-built client, primarily so tests can inject a stub
	 */
	public constructor(config: S3Config, client?: S3Client) {
		const { bucket, keyPrefix, region, endpoint, forcePathStyle, credentials, maxAttempts } = config;

		this.bucket = bucket;
		this.keyPrefix = keyPrefix;
		this.injectedClient = client;
		this.clientConfig = {
			...(region && { region }),
			...(endpoint && { endpoint }),
			forcePathStyle,
			...(credentials && { credentials }),
			...(maxAttempts && { maxAttempts }),
		};

		// An uploader only exists when one was explicitly configured, so staging
		// files are transient by default and only kept when asked for.
		this.deleteAfterUpload = config.deleteAfterUpload ?? true;
	}

	/**
	 * `@aws-sdk/client-s3` is a large require() graph, so it is pulled in on the
	 * first upload rather than at module load. Media nodes without an `s3://`
	 * upload URI never construct this class, and so never pay for the SDK.
	 *
	 * The promise is memoised, so concurrent uploads share a single import and a
	 * single client.
	 */
	private async ensureSdk(): Promise<S3Sdk> {
		this.sdk ??= import('@aws-sdk/client-s3').then(({ S3Client: S3ClientCtor, PutObjectCommand }) => {
			this.client = this.injectedClient ?? new S3ClientCtor(this.clientConfig);

			logger.debug('ensureSdk() aws sdk loaded [bucket: %s]', this.bucket);

			return { client: this.client, PutObjectCommand };
		});

		return this.sdk;
	}

	public async upload({ key, body, sourcePath, contentType }: UploadOptions): Promise<void> {
		const targetKey = this.buildKey(key);

		this.stats.ongoingUploads++;

		try {
			const payload = sourcePath !== undefined ? await readFile(sourcePath) : body;

			if (payload === undefined) {
				throw new Error(`upload() neither body nor sourcePath given [key: ${targetKey}]`);
			}

			const { client, PutObjectCommand } = await this.ensureSdk();

			await client.send(new PutObjectCommand({
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
