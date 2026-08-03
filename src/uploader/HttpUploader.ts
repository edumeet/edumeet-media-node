import { Logger } from 'edumeet-common';
import { readFile } from 'fs/promises';
import { HttpConfig } from './samplesUploadUri';
import { Uploader, UploadOptions } from './Uploader';

const logger = new Logger('HttpUploader');

const DEFAULT_MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_BASE_DELAY_MS = 100;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 429 and 5xx are worth another go; other 4xx mean the request itself is wrong. */
const isRetriable = (status: number): boolean => status === 429 || status >= 500;

/**
 * POSTs objects to an HTTP endpoint.
 *
 * The key is appended to the base path, so a key of `some/path/object.json` is
 * POSTed to `<baseUrl>/some/path/object.json` with the payload as the raw body.
 * That mirrors the layout the S3 uploader produces, so a receiver sees the same
 * hierarchy whichever backend is configured.
 */
export class HttpUploader implements Uploader {
	public readonly stats = {
		ongoingUploads: 0,
		completedUploads: 0,
		failedUploads: 0,
	};
	public readonly deleteAfterUpload: boolean;

	private readonly baseUrl: string;
	private readonly token?: string;
	private readonly maxAttempts: number;
	private readonly fetchImpl: typeof fetch;

	/**
	 * @param config resolved by `parseSamplesUploadUri()`
	 * @param fetchImpl injectable, primarily so tests can stub the transport
	 */
	public constructor(config: HttpConfig, fetchImpl: typeof fetch = fetch) {
		this.baseUrl = config.url;
		this.token = config.token;
		this.maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
		this.fetchImpl = fetchImpl;
		this.deleteAfterUpload = config.deleteAfterUpload ?? false;
	}

	public async upload({ key, body, sourcePath, contentType }: UploadOptions): Promise<void> {
		this.stats.ongoingUploads++;

		try {
			const payload = sourcePath !== undefined ? await readFile(sourcePath) : body;

			if (payload === undefined) {
				throw new Error(`upload() neither body nor sourcePath given [key: ${key}]`);
			}

			await this.post(this.buildUrl(key), payload, contentType);

			this.stats.completedUploads++;
		} catch (error) {
			this.stats.failedUploads++;

			throw error;
		} finally {
			this.stats.ongoingUploads--;
		}
	}

	/** One logical upload, retried up to `maxAttempts` times. */
	private async post(target: string, payload: NonNullable<UploadOptions['body']>, contentType: string): Promise<void> {
		let lastError: Error | undefined;

		for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
			if (attempt > 1) await delay(RETRY_BASE_DELAY_MS * (2 ** (attempt - 2)));

			let response: Response;

			try {
				response = await this.fetchImpl(target, {
					method: 'POST',
					headers: {
						'content-type': contentType,
						...(this.token && { authorization: `Bearer ${this.token}` }),
					},
					body: payload,
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				});
			} catch (error) {
				// Network failure or timeout, both worth retrying.
				lastError = error as Error;

				continue;
			}

			if (response.ok) {
				logger.debug('post() uploaded [url: %s, status: %d]', target, response.status);

				return;
			}

			lastError = new Error(`POST ${target} failed with ${response.status} ${response.statusText}`);

			if (!isRetriable(response.status)) break;
		}

		throw lastError;
	}

	/** Append the logical key to the base path, escaping each segment. */
	private buildUrl(key: string): string {
		const path = key
			.split('/')
			.filter(Boolean)
			.map(encodeURIComponent)
			.join('/');

		return `${this.baseUrl}/${path}`;
	}
}
