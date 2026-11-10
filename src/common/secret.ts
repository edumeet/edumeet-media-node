// The secret shared with the room servers. MEDIA_SECRET is preferred to --secret: every
// account on the host can read a process's command line, but not its environment.
export const mediaSecret = (arg: unknown, env: NodeJS.ProcessEnv = process.env): string | undefined => {
	if (typeof arg === 'string' || typeof arg === 'number') return String(arg);

	return env.MEDIA_SECRET || undefined;
};
