import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { access, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createUploader } from '../../../src/uploader/Uploader';
import { S3Uploader } from '../../../src/uploader/S3Uploader';
import { HttpUploader } from '../../../src/uploader/HttpUploader';
import { HttpConfig, parseSamplesUploadUri, S3Config } from '../../../src/uploader/samplesUploadUri';

const EMPTY_ENV: NodeJS.ProcessEnv = {};

/** Narrow the parsed union to the member each uploader expects. */
const s3Config = (raw: string, env: NodeJS.ProcessEnv = EMPTY_ENV): S3Config => {
	const config = parseSamplesUploadUri(raw, env);

	if (config.type !== 's3') throw new Error(`expected an s3 config, got "${config.type}"`);

	return config;
};

const httpConfig = (raw: string, env: NodeJS.ProcessEnv = EMPTY_ENV): HttpConfig => {
	const config = parseSamplesUploadUri(raw, env);

	if (config.type !== 'http') throw new Error(`expected an http config, got "${config.type}"`);

	return config;
};

const stubFetch = (...responses: Partial<Response>[]) => {
	const impl = jest.fn();

	for (const response of responses) {
		impl.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', ...response } as Response);
	}

	return impl as unknown as jest.MockedFunction<typeof fetch>;
};

const stubClient = () => {
	const send = jest.fn().mockResolvedValue({});

	return { send, client: { send } as unknown as S3Client };
};

const lastCommand = (send: jest.Mock): PutObjectCommand => send.mock.calls[send.mock.calls.length - 1][0];

describe('createUploader', () => {
	test('returns undefined when no value is given', () => {
		expect(createUploader(undefined)).toBeUndefined();
	});

	test('returns undefined for a valueless flag (minimist yields true)', () => {
		expect(createUploader(true)).toBeUndefined();
	});

	test('returns undefined for a malformed value instead of throwing', () => {
		expect(createUploader('s3://bucket?regoin=eu-north-1')).toBeUndefined();
		expect(createUploader('my-bucket//http://minio:9000')).toBeUndefined();
		expect(createUploader('s3://key:secret@bucket')).toBeUndefined();
	});

	test('builds an S3Uploader for a valid value', () => {
		expect(createUploader('s3://bucket/prod?region=eu-north-1')).toBeInstanceOf(S3Uploader);
	});

	test('builds an HttpUploader for an http(s) value', () => {
		expect(createUploader('http://collector/samples')).toBeInstanceOf(HttpUploader);
		expect(createUploader('https://collector/samples')).toBeInstanceOf(HttpUploader);
	});

	test('accepts the bare bucket shorthand', () => {
		expect(createUploader('my-bucket')).toBeInstanceOf(S3Uploader);
	});
});

describe('S3Uploader', () => {
	test('sends the body to the configured bucket under the given key', async () => {
		const { send, client } = stubClient();
		const uploader = new S3Uploader(s3Config('s3://samples'), client);

		await uploader.upload({ key: 'room/call/summary.json', body: '{"a":1}', contentType: 'application/json' });

		expect(send).toHaveBeenCalledTimes(1);
		expect(lastCommand(send).input).toMatchObject({
			Bucket: 'samples',
			Key: 'room/call/summary.json',
			Body: '{"a":1}',
			ContentType: 'application/json',
		});
	});

	test('prepends the key prefix from the URI', async () => {
		const { send, client } = stubClient();
		const uploader = new S3Uploader(s3Config('s3://samples/prod/eu'), client);

		await uploader.upload({ key: 'room/call/summary.json', body: 'x', contentType: 'application/json' });

		expect(lastCommand(send).input.Key).toBe('prod/eu/room/call/summary.json');
	});

	test('leaves the key untouched when the URI has no prefix', async () => {
		const { send, client } = stubClient();
		const uploader = new S3Uploader(s3Config('s3://samples'), client);

		await uploader.upload({ key: 'room/call/c.jsonl', body: 'x', contentType: 'application/x-ndjson' });

		expect(lastCommand(send).input.Key).toBe('room/call/c.jsonl');
	});

	test('propagates client failures to the caller', async () => {
		const { send, client } = stubClient();

		send.mockRejectedValueOnce(new Error('no such bucket'));

		const uploader = new S3Uploader(s3Config('s3://samples'), client);

		await expect(uploader.upload({ key: 'k', body: 'x', contentType: 'application/json' })).rejects.toThrow('no such bucket');
	});
});

describe('S3Uploader - sourcePath', () => {
	test('reads the file and uploads its contents under the prefixed key', async () => {
		const { send, client } = stubClient();
		const dir = await mkdtemp(join(tmpdir(), 'uploader-'));
		const sourcePath = join(dir, 'client.jsonl');

		await writeFile(sourcePath, '{"n":1}\n{"n":2}\n');

		const uploader = new S3Uploader(s3Config('s3://samples/prod'), client);

		await uploader.upload({ key: 'room/call/client.jsonl', sourcePath, contentType: 'application/x-ndjson' });

		const { Bucket, Key, Body, ContentType } = lastCommand(send).input;

		expect(Bucket).toBe('samples');
		expect(Key).toBe('prod/room/call/client.jsonl');
		expect(ContentType).toBe('application/x-ndjson');
		expect(Body?.toString()).toBe('{"n":1}\n{"n":2}\n');
	});

	test('rejects when the file is missing', async () => {
		const { client } = stubClient();
		const uploader = new S3Uploader(s3Config('s3://samples'), client);

		await expect(uploader.upload({ key: 'k', sourcePath: '/nope/missing.jsonl', contentType: 'application/x-ndjson' })).rejects.toThrow();
	});

	test('does not delete the source file after successful upload (cleanup is ObserverService-owned)', async () => {
		const { client } = stubClient();
		const dir = await mkdtemp(join(tmpdir(), 'uploader-delete-'));
		const sourcePath = join(dir, 'client.jsonl');

		await writeFile(sourcePath, '{"n":1}\n');

		const uploader = new S3Uploader(s3Config('s3://samples?deleteAfterUpload=true'), client);

		await uploader.upload({ key: 'room/call/client.jsonl', sourcePath, contentType: 'application/x-ndjson' });

		await expect(access(sourcePath)).resolves.toBeUndefined();
	});
});

describe('HttpUploader', () => {
	test('POSTs the body to the base URL with the key appended', async () => {
		const impl = stubFetch({});
		const uploader = new HttpUploader(httpConfig('https://collector/samples'), impl);

		await uploader.upload({ key: 'room/call/client.jsonl', body: '{"n":1}', contentType: 'application/x-ndjson' });

		const [ url, init ] = impl.mock.calls[0];

		expect(url).toBe('https://collector/samples/room/call/client.jsonl');
		expect(init?.method).toBe('POST');
		expect(init?.body).toBe('{"n":1}');
		expect((init?.headers as Record<string, string>)['content-type']).toBe('application/x-ndjson');
	});

	test('sends a bearer token when one is configured', async () => {
		const impl = stubFetch({});
		const config = httpConfig('https://collector/s?credentialsEnv=COLLECTOR', { COLLECTOR_TOKEN: 't0ken' });

		await new HttpUploader(config, impl).upload({ key: 'k', body: 'x', contentType: 'application/json' });

		expect((impl.mock.calls[0][1]?.headers as Record<string, string>).authorization).toBe('Bearer t0ken');
	});

	test('omits the authorization header when no token is configured', async () => {
		const impl = stubFetch({});

		await new HttpUploader(httpConfig('https://collector/s'), impl).upload({ key: 'k', body: 'x', contentType: 'application/json' });

		expect((impl.mock.calls[0][1]?.headers as Record<string, string>).authorization).toBeUndefined();
	});

	test('escapes each key segment', async () => {
		const impl = stubFetch({});

		await new HttpUploader(httpConfig('https://collector/s'), impl).upload({ key: 'room a/call#1/c.jsonl', body: 'x', contentType: 'application/json' });

		expect(impl.mock.calls[0][0]).toBe('https://collector/s/room%20a/call%231/c.jsonl');
	});

	test('retries a 5xx and resolves once it succeeds', async () => {
		const impl = stubFetch({ ok: false, status: 503, statusText: 'Service Unavailable' }, {});

		await new HttpUploader(httpConfig('https://collector/s?maxAttempts=3'), impl).upload({ key: 'k', body: 'x', contentType: 'application/json' });

		expect(impl).toHaveBeenCalledTimes(2);
	});

	test('does not retry a 4xx', async () => {
		const impl = stubFetch({ ok: false, status: 400, statusText: 'Bad Request' });

		await expect(new HttpUploader(httpConfig('https://collector/s?maxAttempts=3'), impl).upload({ key: 'k', body: 'x', contentType: 'application/json' }))
			.rejects.toThrow(/400 Bad Request/);
		expect(impl).toHaveBeenCalledTimes(1);
	});

	test('gives up after maxAttempts', async () => {
		const impl = stubFetch({ ok: false, status: 500, statusText: 'Server Error' }, { ok: false, status: 500, statusText: 'Server Error' });

		await expect(new HttpUploader(httpConfig('https://collector/s?maxAttempts=2'), impl).upload({ key: 'k', body: 'x', contentType: 'application/json' }))
			.rejects.toThrow(/500 Server Error/);
		expect(impl).toHaveBeenCalledTimes(2);
	});

	test('retries a network failure', async () => {
		const impl = jest.fn()
			.mockRejectedValueOnce(new Error('ECONNREFUSED'))
			.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' } as Response) as unknown as jest.MockedFunction<typeof fetch>;

		await new HttpUploader(httpConfig('https://collector/s?maxAttempts=2'), impl).upload({ key: 'k', body: 'x', contentType: 'application/json' });

		expect(impl).toHaveBeenCalledTimes(2);
	});

	test('reads the file and POSTs its contents', async () => {
		const impl = stubFetch({});
		const dir = await mkdtemp(join(tmpdir(), 'http-uploader-'));
		const sourcePath = join(dir, 'client.jsonl');

		await writeFile(sourcePath, '{"n":1}\n');

		await new HttpUploader(httpConfig('https://collector/s'), impl).upload({ key: 'room/c.jsonl', sourcePath, contentType: 'application/x-ndjson' });

		expect(impl.mock.calls[0][0]).toBe('https://collector/s/room/c.jsonl');
		expect(impl.mock.calls[0][1]?.body?.toString()).toBe('{"n":1}\n');
	});

	test('does not delete the source file after successful upload (cleanup is ObserverService-owned)', async () => {
		const impl = stubFetch({});
		const dir = await mkdtemp(join(tmpdir(), 'http-uploader-delete-'));
		const sourcePath = join(dir, 'client.jsonl');

		await writeFile(sourcePath, '{"n":1}\n');

		const uploader = new HttpUploader(httpConfig('https://collector/s?deleteAfterUpload=true'), impl);

		await uploader.upload({ key: 'room/call/client.jsonl', sourcePath, contentType: 'application/x-ndjson' });

		await expect(access(sourcePath)).resolves.toBeUndefined();
	});
});

describe('Uploader contract', () => {
	test('rejects when neither body nor sourcePath is given', async () => {
		const { client } = stubClient();
		const impl = stubFetch({});

		await expect(new S3Uploader(s3Config('s3://samples'), client)
			.upload({ key: 'k', contentType: 'application/json' })).rejects.toThrow(/neither body nor sourcePath/);
		await expect(new HttpUploader(httpConfig('https://collector/s'), impl)
			.upload({ key: 'k', contentType: 'application/json' })).rejects.toThrow(/neither body nor sourcePath/);
	});

	test('sourcePath takes precedence over body', async () => {
		const { send, client } = stubClient();
		const dir = await mkdtemp(join(tmpdir(), 'precedence-'));
		const sourcePath = join(dir, 'from-disk.jsonl');

		await writeFile(sourcePath, 'from-disk');

		await new S3Uploader(s3Config('s3://samples'), client)
			.upload({ key: 'k', body: 'from-memory', sourcePath, contentType: 'application/json' });

		expect(lastCommand(send).input.Body?.toString()).toBe('from-disk');
	});

	test('S3Uploader counts completed and failed uploads', async () => {
		const { send, client } = stubClient();
		const uploader = new S3Uploader(s3Config('s3://samples'), client);

		expect(uploader.stats).toEqual({ ongoingUploads: 0, completedUploads: 0, failedUploads: 0 });

		await uploader.upload({ key: 'a', body: 'x', contentType: 'application/json' });

		expect(uploader.stats).toEqual({ ongoingUploads: 0, completedUploads: 1, failedUploads: 0 });

		send.mockRejectedValueOnce(new Error('boom'));
		await expect(uploader.upload({ key: 'b', body: 'x', contentType: 'application/json' })).rejects.toThrow('boom');

		expect(uploader.stats).toEqual({ ongoingUploads: 0, completedUploads: 1, failedUploads: 1 });
	});

	test('HttpUploader counts a retried upload once', async () => {
		const impl = stubFetch({ ok: false, status: 503, statusText: 'Service Unavailable' }, {});
		const uploader = new HttpUploader(httpConfig('https://collector/s?maxAttempts=3'), impl);

		await uploader.upload({ key: 'k', body: 'x', contentType: 'application/json' });

		expect(impl).toHaveBeenCalledTimes(2);
		expect(uploader.stats).toEqual({ ongoingUploads: 0, completedUploads: 1, failedUploads: 0 });
	});

	test('ongoingUploads tracks work in flight', async () => {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const impl = jest.fn().mockImplementation(async () => {
			await gate;

			return { ok: true, status: 200, statusText: 'OK' } as Response;
		}) as unknown as jest.MockedFunction<typeof fetch>;
		const uploader = new HttpUploader(httpConfig('https://collector/s'), impl);
		const inFlight = uploader.upload({ key: 'k', body: 'x', contentType: 'application/json' });

		await Promise.resolve();
		expect(uploader.stats.ongoingUploads).toBe(1);

		release();
		await inFlight;

		expect(uploader.stats).toEqual({ ongoingUploads: 0, completedUploads: 1, failedUploads: 0 });
	});
});

describe('createUploader - credential resolution failures', () => {
	test('returns undefined when the s3 credential variables are missing', () => {
		expect(createUploader('s3://bucket?credentialsEnv=NOPE')).toBeUndefined();
	});

	test('returns undefined when the http token variable is missing', () => {
		expect(createUploader('https://collector/s?credentialsEnv=NOPE')).toBeUndefined();
	});
});

describe('S3Uploader - client configuration', () => {
	const clientOf = (uploader: S3Uploader): S3Client =>
		(uploader as unknown as { client: S3Client }).client;

	test('applies region and path style from the URI', async () => {
		const uploader = new S3Uploader(s3Config('s3://bucket?endpoint=http://minio:9000&region=eu-north-1'));
		const { config } = clientOf(uploader);

		expect(await config.region()).toBe('eu-north-1');
		expect(config.forcePathStyle).toBe(true);
	});

	test('leaves path style off for a plain AWS target', async () => {
		expect(clientOf(new S3Uploader(s3Config('s3://bucket?region=eu-west-1'))).config.forcePathStyle).toBe(false);
	});
});

describe('S3Uploader - payload types', () => {
	test('passes a Buffer body through unchanged', async () => {
		const { send, client } = stubClient();
		const body = Buffer.from('binary-ish');

		await new S3Uploader(s3Config('s3://samples'), client)
			.upload({ key: 'k', body, contentType: 'application/octet-stream' });

		expect(lastCommand(send).input.Body).toBe(body);
	});

	test('passes a Uint8Array body through unchanged', async () => {
		const { send, client } = stubClient();
		const body = new Uint8Array([ 1, 2, 3 ]);

		await new S3Uploader(s3Config('s3://samples'), client)
			.upload({ key: 'k', body, contentType: 'application/octet-stream' });

		expect(lastCommand(send).input.Body).toBe(body);
	});
});

describe('HttpUploader - retry policy', () => {
	test('retries a 429', async () => {
		const impl = stubFetch({ ok: false, status: 429, statusText: 'Too Many Requests' }, {});

		await new HttpUploader(httpConfig('https://collector/s?maxAttempts=2'), impl)
			.upload({ key: 'k', body: 'x', contentType: 'application/json' });

		expect(impl).toHaveBeenCalledTimes(2);
	});

	test('defaults to three attempts when maxAttempts is absent', async () => {
		const failure = { ok: false, status: 500, statusText: 'Server Error' };
		const impl = stubFetch(failure, failure, failure);

		await expect(new HttpUploader(httpConfig('https://collector/s'), impl)
			.upload({ key: 'k', body: 'x', contentType: 'application/json' })).rejects.toThrow(/500/);

		expect(impl).toHaveBeenCalledTimes(3);
	});

	test('counts one failed upload after exhausting attempts', async () => {
		const failure = { ok: false, status: 500, statusText: 'Server Error' };
		const impl = stubFetch(failure, failure);
		const uploader = new HttpUploader(httpConfig('https://collector/s?maxAttempts=2'), impl);

		await expect(uploader.upload({ key: 'k', body: 'x', contentType: 'application/json' })).rejects.toThrow();

		expect(uploader.stats).toEqual({ ongoingUploads: 0, completedUploads: 0, failedUploads: 1 });
	});

	test('backs off between attempts rather than hammering', async () => {
		const failure = { ok: false, status: 500, statusText: 'Server Error' };
		const impl = stubFetch(failure, failure, failure);
		const started = Date.now();

		await expect(new HttpUploader(httpConfig('https://collector/s?maxAttempts=3'), impl)
			.upload({ key: 'k', body: 'x', contentType: 'application/json' })).rejects.toThrow();

		// 100ms before the second attempt, 200ms before the third.
		expect(Date.now() - started).toBeGreaterThanOrEqual(250);
	});

	test('does not sleep before failing on a non-retriable status', async () => {
		const impl = stubFetch({ ok: false, status: 403, statusText: 'Forbidden' });
		const started = Date.now();

		await expect(new HttpUploader(httpConfig('https://collector/s?maxAttempts=3'), impl)
			.upload({ key: 'k', body: 'x', contentType: 'application/json' })).rejects.toThrow(/403/);

		expect(Date.now() - started).toBeLessThan(100);
	});
});

describe('HttpUploader - request shape', () => {
	test('passes an abort signal so a hung collector cannot stall uploads', async () => {
		const impl = stubFetch({});

		await new HttpUploader(httpConfig('https://collector/s'), impl)
			.upload({ key: 'k', body: 'x', contentType: 'application/json' });

		expect(impl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
	});

	test('drops empty key segments instead of producing double slashes', async () => {
		const impl = stubFetch({});

		await new HttpUploader(httpConfig('https://collector/s'), impl)
			.upload({ key: '/room//call/c.jsonl', body: 'x', contentType: 'application/json' });

		expect(impl.mock.calls[0][0]).toBe('https://collector/s/room/call/c.jsonl');
	});
});

describe('deleteAfterUpload wiring', () => {
	test('reaches the uploader from the URI', () => {
		expect(new S3Uploader(s3Config('s3://samples?deleteAfterUpload=true')).deleteAfterUpload).toBe(true);
		expect(new HttpUploader(httpConfig('https://collector/s?deleteAfterUpload=true')).deleteAfterUpload).toBe(true);
	});

	test('defaults to false when the URI is silent', () => {
		expect(new S3Uploader(s3Config('s3://samples')).deleteAfterUpload).toBe(false);
		expect(new HttpUploader(httpConfig('https://collector/s')).deleteAfterUpload).toBe(false);
	});

	test('survives createUploader', () => {
		expect(createUploader('s3://samples?deleteAfterUpload=true')?.deleteAfterUpload).toBe(true);
		expect(createUploader('https://collector/s?deleteAfterUpload=true')?.deleteAfterUpload).toBe(true);
		expect(createUploader('s3://samples')?.deleteAfterUpload).toBe(false);
	});
});

describe('Uploader stats - isolation and concurrency', () => {
	test('each uploader keeps its own counters', async () => {
		const first = new S3Uploader(s3Config('s3://samples'), stubClient().client);
		const second = new S3Uploader(s3Config('s3://samples'), stubClient().client);

		await first.upload({ key: 'k', body: 'x', contentType: 'application/json' });

		expect(first.stats.completedUploads).toBe(1);
		expect(second.stats.completedUploads).toBe(0);
	});

	test('ongoingUploads counts concurrent uploads', async () => {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const send = jest.fn().mockImplementation(async () => {
			await gate;

			return {};
		});
		const uploader = new S3Uploader(s3Config('s3://samples'), { send } as unknown as S3Client);
		const inFlight = [
			uploader.upload({ key: 'a', body: 'x', contentType: 'application/json' }),
			uploader.upload({ key: 'b', body: 'x', contentType: 'application/json' }),
		];

		await Promise.resolve();
		expect(uploader.stats.ongoingUploads).toBe(2);

		release();
		await Promise.all(inFlight);

		expect(uploader.stats).toEqual({ ongoingUploads: 0, completedUploads: 2, failedUploads: 0 });
	});
});
