import { Logger } from 'edumeet-common';
import MediaService, { WorkerData } from './MediaService';
import si from 'systeminformation';

export type AvailableBandwidth = {
	upload: number; // Mbps
	download: number; // Mbps
};

const logger = new Logger('LoadManager');

export default class LoadManager {
	private mediaService: MediaService;
	private availableBandwidth: AvailableBandwidth;
	private loadPollingInterval: number;
	public load = 0;
	public uploadBandwidth = 0;
	public downloadBandwidth = 0;
	public cpuLoad = 0;

	constructor(mediaService: MediaService, availableBandwidth: AvailableBandwidth, loadPollingInterval: number) {
		this.mediaService = mediaService;
		this.availableBandwidth = availableBandwidth;
		this.loadPollingInterval = loadPollingInterval;

		this.start();
	}

	public start(): void {
		setInterval(() => {
			this.pollLoad();
		}, this.loadPollingInterval);

		this.pollLoad();
	}

	private async pollLoad(): Promise<void> {
		const cpuUsages: number[] = [];
		let cpuLoad = 0;
		let networkLoad = 0;

		for (const worker of this.mediaService.workers.items) {
			const { cpuUsage } = worker.appData as unknown as WorkerData;

			cpuUsages.push(cpuUsage);
			cpuLoad += cpuUsage;
		}

		cpuLoad /= this.mediaService.workers.length;
		this.cpuLoad = cpuLoad;

		const networkStats = await si.networkStats();

		let uploadBandwidth = 0;
		let downloadBandwidth = 0;

		for (const iface of networkStats) {
			if (iface.iface === 'lo') continue;

			uploadBandwidth += iface.tx_sec;
			downloadBandwidth += iface.rx_sec;
		}

		this.uploadBandwidth = uploadBandwidth / 125000;
		this.downloadBandwidth = downloadBandwidth / 125000;

		logger.debug(
			'pollLoad() [cpuLoads: %o, uploadBw: %s, downloadBw: %s]',
			cpuUsages,
			this.uploadBandwidth.toFixed(3),
			this.downloadBandwidth.toFixed(3)
		);

		const uploadBandwidthPercentage = (this.uploadBandwidth / this.availableBandwidth.upload) * 100;
		const downloadBandwidthPercentage = (this.downloadBandwidth / this.availableBandwidth.download) * 100;

		networkLoad = Math.max(uploadBandwidthPercentage, downloadBandwidthPercentage);

		this.load = Math.max(cpuLoad, networkLoad);
	}

	public getLoadJson(): string {
		return JSON.stringify({
			load: this.load,
			cpuLoad: this.cpuLoad,
			uploadBandwidth: this.uploadBandwidth,
			downloadBandwidth: this.downloadBandwidth,
			uploadBandwidthUsage: (this.uploadBandwidth / this.availableBandwidth.upload) * 100,
			downloadBandwidthUsage: (this.downloadBandwidth / this.availableBandwidth.download) * 100,
		});
	}
}
