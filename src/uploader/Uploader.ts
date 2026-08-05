import { Logger } from 'edumeet-common';
import { describeSamplesUploadConfig, parseSamplesUploadUri, SamplesUploadConfig } from './samplesUploadUri';
import { S3Uploader } from './S3Uploader';
import { HttpUploader } from './HttpUploader';

const logger = new Logger('Uploader');

export type UploadBody = string | Uint8Array | Buffer;

/**
 * A destination for uploaded objects.
 *
 * Keys are logical and relative, e.g. `some/path/object.json`. Where that
 * actually lands — bucket, key prefix, base URL — is the implementation's
 * business, so nothing above this type needs to know which backend is in use.
 *
 * Nothing here is specific to observertc, or to this service: an uploader is
 * just "somewhere bytes go, addressed by key".
 */
/*
 * The base no-unused-vars rule does not understand type-level parameter names,
 * so it flags the ones below. They are documentation, not bindings.
 */
/* eslint-disable no-unused-vars */
export type UploadOptions = {

	/** Logical, relative key, e.g. `some/path/object.json`. */
	key: string;

	/** In-memory payload. Ignored when `sourcePath` is given. */
	body?: UploadBody;

	/** Read the payload from this file instead. Takes precedence over `body`. */
	sourcePath?: string;
	contentType: string;
};

export type Uploader = {
	stats?: {
		ongoingUploads: number;
		completedUploads: number;
		failedUploads: number;
	};
	deleteAfterUpload: boolean;

	upload(options: UploadOptions): Promise<void>;
}
/* eslint-enable no-unused-vars */

/**
 * One case per member of SamplesUploadConfig.
 *
 * The return type deliberately excludes undefined, so adding a member to that
 * union without a case here fails to compile rather than quietly yielding "no
 * uploader".
 */
const buildUploader = (config: SamplesUploadConfig): Uploader => {
	switch (config.type) {
		case 's3':
			return new S3Uploader(config);

		case 'http':
			return new HttpUploader(config);
	}
};

/**
 * Build the uploader described by an upload URI.
 *
 * This is the one place in the folder tied to how this service is configured:
 * the URI comes from `--samplesUploadUri` and is parsed by `samplesUploadUri`.
 * The uploaders it returns are not — point a different parser at them and they
 * work unchanged.
 *
 * Returns undefined when uploads should stay off: either no value was given, or
 * it was malformed, in which case the reason is logged. Never throws, so a bad
 * flag degrades to "no uploads" instead of taking the media node down.
 *
 * The value is typed `unknown` because it arrives straight from minimist, which
 * yields a boolean for a valueless `--samplesUploadUri` rather than a string.
 */
export const createUploader = (uri: unknown): Uploader | undefined => {
	if (uri === undefined) return undefined;

	if (typeof uri !== 'string') {
		logger.warn('createUploader() --samplesUploadUri needs a value, uploads disabled [example: s3://my-bucket]');

		return undefined;
	}

	let config: SamplesUploadConfig;

	try {
		config = parseSamplesUploadUri(uri);
	} catch (error) {
		logger.warn('createUploader() uploads disabled [reason: %s]', (error as Error).message);

		return undefined;
	}

	// Safe to log: the resolved config holds credential references, not values.
	logger.debug('createUploader() uploads enabled [config: %o]', describeSamplesUploadConfig(config));

	return buildUploader(config);
};
