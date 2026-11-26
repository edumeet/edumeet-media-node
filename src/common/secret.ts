// The secret shared with the room servers. MEDIA_SECRET is preferred to --secret: every
// account on the host can read a process's command line, but not its environment.
// undefined when there is none; the media node does not start then.
export const mediaSecret = (arg: unknown, env: NodeJS.ProcessEnv = process.env): string | undefined => {
	if ((typeof arg === 'string' && arg !== '') || typeof arg === 'number') return String(arg);

	return env.MEDIA_SECRET || undefined;
};

// Whether a connection presented the node's secret. Written so that nothing matches a node
// without a secret: comparing the two values alone would let a connection that sends no
// secret into a node that has none.
export const isRoomServerSecret = (presented: unknown, secret: string | undefined): boolean =>
	typeof secret === 'string' && secret !== '' && typeof presented === 'string' && presented === secret;
