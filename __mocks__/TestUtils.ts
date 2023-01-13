export default class TestUtils {
	static sleep = async (ms: number) => {
		return new Promise((resolve) => {
			setTimeout(resolve, ms);
		});
	};

}