import os from 'os';

export const getCpuLoad = () => {
	return os.loadavg()[0] / os.cpus().length;
};