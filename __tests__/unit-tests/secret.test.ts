import { mediaSecret } from '../../src/common/secret';

test('takes --secret when it is given', () => {
	expect(mediaSecret('from-argv', { MEDIA_SECRET: 'from-env' })).toBe('from-argv');
});

test('falls back to MEDIA_SECRET, so the secret can stay off the command line', () => {
	expect(mediaSecret(undefined, { MEDIA_SECRET: 'from-env' })).toBe('from-env');
	expect(mediaSecret(true, { MEDIA_SECRET: 'from-env' })).toBe('from-env');
});

test('has no secret when neither is set', () => {
	expect(mediaSecret(undefined, {})).toBeUndefined();
	expect(mediaSecret(undefined, { MEDIA_SECRET: '' })).toBeUndefined();
});
