import { isRoomServerSecret, mediaSecret } from '../../src/common/secret';

test('takes --secret when it is given', () => {
	expect(mediaSecret('from-argv', { MEDIA_SECRET: 'from-env' })).toBe('from-argv');
	expect(mediaSecret(12345, { MEDIA_SECRET: 'from-env' })).toBe('12345');
});

test('falls back to MEDIA_SECRET, so the secret can stay off the command line', () => {
	expect(mediaSecret(undefined, { MEDIA_SECRET: 'from-env' })).toBe('from-env');
	// --secret without a value
	expect(mediaSecret(true, { MEDIA_SECRET: 'from-env' })).toBe('from-env');
	expect(mediaSecret('', { MEDIA_SECRET: 'from-env' })).toBe('from-env');
});

test('has no secret when neither is set', () => {
	expect(mediaSecret(undefined, {})).toBeUndefined();
	expect(mediaSecret(undefined, { MEDIA_SECRET: '' })).toBeUndefined();
	expect(mediaSecret(true, {})).toBeUndefined();
	expect(mediaSecret('', { MEDIA_SECRET: '' })).toBeUndefined();
});

describe('the secret a room server presents', () => {
	test('is accepted when it is the node\'s secret', () => {
		expect(isRoomServerSecret('s3cret', 's3cret')).toBe(true);
	});

	test('is refused when it is another one', () => {
		expect(isRoomServerSecret('other', 's3cret')).toBe(false);
		expect(isRoomServerSecret('s3cret ', 's3cret')).toBe(false);
	});

	// A handshake without the parameter has undefined, a repeated parameter an array.
	test('is refused when it is missing or not one string', () => {
		expect(isRoomServerSecret(undefined, 's3cret')).toBe(false);
		expect(isRoomServerSecret('', 's3cret')).toBe(false);
		expect(isRoomServerSecret([ 's3cret' ], 's3cret')).toBe(false);
		expect(isRoomServerSecret([ 's3cret', 's3cret' ], 's3cret')).toBe(false);
	});

	// The node does not start without a secret. If it ever ran without one, a connection
	// that presents none must not match it.
	test('is refused when the node has no secret', () => {
		expect(isRoomServerSecret(undefined, undefined)).toBe(false);
		expect(isRoomServerSecret('', '')).toBe(false);
		expect(isRoomServerSecret('undefined', undefined)).toBe(false);
	});
});
