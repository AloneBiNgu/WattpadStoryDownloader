const { app, ipcMain, dialog, BrowserWindow } = require('electron/main');
const path = require('node:path');
const fs = require('fs').promises;
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const http = require('http');
const https = require('https');

const axiosInstance = axios.create({
	timeout: 30000, // Timeout 30 giây
	httpAgent: new http.Agent({ keepAlive: true }),
	httpsAgent: new https.Agent({ keepAlive: true }),
	maxRedirects: 5,
	headers: {
		accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'accept-language': 'en-US,en;q=0.5',
		'cache-control': 'no-cache',
		pragma: 'no-cache',
		'sec-gpc': '1',
		Connection: 'keep-alive',
		'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
	},
});

// Cấu hình retry
axiosRetry(axiosInstance, {
	retries: 3,
	retryDelay: (retryCount) => retryCount * 1000,
	retryCondition: (error) => {
		return axios.isAxiosError(error) || error.code === 'ECONNABORTED' || (error.response && error.response.status >= 500);
	},
});

// Hàm quản lý lỗi mạng chi tiết
function handleNetworkError(error) {
	console.error('Network Error:', error.message);
	if (error.response) {
		console.error('Response Status:', error.response.status);
		console.error('Response Data:', error.response.data);
	}
}

// Hàm đảm bảo tên file an toàn
async function ensureSafeFileName(fileName) {
	return fileName
		.replace(/[<>:"/\\|?*]/g, '')
		.substring(0, 255)
		.trim();
}

// Hàm kiểm tra URL hợp lệ
function validateDownloadUrl(url) {
	const wattpadRegex = /^https?:\/\/(www\.)?wattpad\.com\/.+/;
	if (!wattpadRegex.test(url)) {
		throw new Error('URL không hợp lệ. Vui lòng sử dụng URL Wattpad.');
	}
}

// Hàm trích xuất các số từ URL
function extractNumbersFromUrl(url) {
	const regex = /\d+/g;
	const numbers = url.match(regex);
	return numbers ? numbers : [];
}

// Hàm lấy dữ liệu câu chuyện hoặc chương
async function getStoryOrChapterData(id, isStoryPart = false) {
	const urls = {
		story: `https://www.wattpad.com/api/v3/stories/${id}?fields=id%2Ctitle%2CcreateDate%2CmodifyDate%2CvoteCount%2CreadCount%2CcommentCount%2Cdescription%2Curl%2CfirstPublishedPart%2Ccover%2Clanguage%2CisAdExempt%2Cuser(name%2Cusername%2Cavatar%2Clocation%2Chighlight_colour%2CbackgroundUrl%2CnumLists%2CnumStoriesPublished%2CnumFollowing%2CnumFollowers%2Ctwitter)%2Ccompleted%2CisPaywalled%2CpaidModel%2CnumParts%2ClastPublishedPart%2Cparts(id%2Ctitle%2Clength%2Curl%2Cdeleted%2Cdraft%2CcreateDate%2CscheduledPublishDatetime)%2Ctags%2Ccategories%2Crating%2Crankings%2CtagRankings%2Clanguage%2CstoryLanguage%2Ccopyright%2CsourceLink%2CfirstPartId%2Cdeleted%2Cdraft%2ChasBannedCover%2Clength&_=${Date.now()}`,
		part: `https://www.wattpad.com/v4/parts/${id}?fields=id%2Ctitle%2Curl%2CmodifyDate%2Clength%2CwordCount%2CvideoId%2CphotoUrl%2CcommentCount%2CvoteCount%2CreadCount%2Cvoted%2Cprivate%2Cpages%2Ctext_url%2Crating%2Cdeleted%2Cdraft%2CisAdExempt%2ChasBannedHeader%2Cgroup(id%2Ctitle%2Ccover%2Curl%2Cuser(username%2Cname%2Cavatar%2Ctwitter%2CauthorMessage)%2Ccategories%2CisAdExempt%2Cdeleted%2Cdraft%2Crating%2Clanguage%2Cdescription%2Ctags%2Ccompleted%2CisPaywalled%2CpaidModel%2Cparts(title%2Curl%2Cid%2Cdeleted%2Cdraft%2Crating%2CscheduledPublishDatetime)%2Crankings)%2Cdedication(name%2Curl)%2Csource(url%2Clabel)&_=${Date.now()}`,
	};

	const url = isStoryPart ? urls.part : urls.story;

	try {
		const { data } = await axiosInstance.get(url);
		return data;
	} catch (error) {
		handleNetworkError(error);
		throw error;
	}
}

// Hàm tải nội dung trang với tối ưu hóa
async function scrapePage(id, page, folder) {
	try {
		let fullContent = '';

		// Tải tuần tự từng trang
		for (let i = 1; i <= page; i++) {
			console.log(`Đang tải trang ${i}...`);
			const response = await axiosInstance.get('https://www.wattpad.com/apiv2/', {
				params: {
					m: 'storytext',
					id: id,
					page: i,
				},
			});
			fullContent += response.data; // Ghép nội dung trang vào tổng nội dung
		}

		// Ghi file một lần duy nhất
		await fs.writeFile(path.join(folder, 'index.html'), fullContent, 'utf8');
		console.log('Tải xuống và ghi file thành công!');
	} catch (error) {
		handleNetworkError(error);
		throw error;
	}
}

// Hàm tải toàn bộ câu chuyện
async function downloadStory(event, json, storyFolder) {
	const totalParts = json.parts.length;

	// Tải tuần tự từng chương
	for (let index = 0; index < totalParts; index++) {
		const chapterInfo = json.parts[index];
		const safeChapterTitle = await ensureSafeFileName(chapterInfo.title);
		const chapterFolder = path.join(storyFolder, safeChapterTitle);

		// Tạo thư mục chương
		await fs.mkdir(chapterFolder, { recursive: true });

		// Lấy dữ liệu chi tiết chương
		const chapterData = await getStoryOrChapterData(chapterInfo.id, true);

		// Báo cáo trạng thái chi tiết
		event.reply('download-status', {
			message: `Đang tải chương ${index + 1}/${totalParts}`,
			stage: 'downloading',
			chapter: chapterData.title,
		});

		// Tải nội dung chương
		await scrapePage(chapterData.id, chapterData.pages, chapterFolder);

		console.log((((index + 1) / totalParts) * 100).toFixed(2));
		// Báo cáo tiến độ
		event.reply('download-progress', {
			current: index + 1,
			total: totalParts,
			percentage: (((index + 1) / totalParts) * 100).toFixed(2),
		});
	}
}

// Hàm tạo cửa sổ chính
function createWindow() {
	const win = new BrowserWindow({
		width: 800,
		height: 600,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			nodeIntegration: false,
			contextIsolation: true,
			allowRunningInsecureContent: true,
		},
	});

	win.setMenuBarVisibility(false);
	win.loadFile(path.join(__dirname, 'index.html'));
}

// Xử lý sự kiện khi ứng dụng sẵn sàng
app.whenReady().then(() => {
	createWindow();

	// Tạo cửa sổ khi nhấn vào icon (macOS)
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

// Xử lý khi đóng tất cả cửa sổ
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

// Xử lý chọn folder
ipcMain.on('select-folder', async (event) => {
	try {
		const result = await dialog.showOpenDialog({
			properties: ['openDirectory'],
		});

		if (!result.canceled) {
			event.reply('folder-selected', result.filePaths[0]);
		}
	} catch (error) {
		console.error('Lỗi khi chọn thư mục:', error);
		event.reply('select-folder-error', error);
	}
});

// Xử lý tải xuống file
ipcMain.on('download-file', async (event, downloadInfo) => {
	try {
		// Validate URL
		validateDownloadUrl(downloadInfo.url);

		// Trích xuất ID từ URL
		const bookId = extractNumbersFromUrl(downloadInfo.url)[0];
		if (!bookId) {
			throw new Error('Không tìm thấy ID trong URL');
		}

		// Báo cáo trạng thái bắt đầu
		event.reply('download-status', {
			message: 'Bắt đầu tải xuống',
			stage: 'init',
		});

		// Lấy thông tin truyện
		const json = await getStoryOrChapterData(bookId);

		// Tạo tên thư mục an toàn
		const safeTitle = await ensureSafeFileName(json.title);
		const storyFolder = path.join(downloadInfo.folderPath, `${safeTitle}_${json.id}`);

		// Tạo thư mục truyện
		await fs.mkdir(storyFolder, { recursive: true });

		// Tải toàn bộ câu chuyện
		await downloadStory(event, json, storyFolder);

		// Hoàn thành tải xuống
		event.reply('download-file-success', storyFolder);
	} catch (error) {
		console.error('Lỗi tải xuống:', error);
		event.reply('download-file-error', {
			message: error.message,
			detail: error.toString(),
		});
	}
});

// Cập nhật cookie định kỳ
function refreshCookies() {
	const newCookies = {
		wp_id: `wp_${Date.now()}`,
		te_session_id: `session_${Date.now()}`,
	};

	axiosInstance.defaults.headers.common['cookie'] = Object.entries(newCookies)
		.map(([key, value]) => `${key}=${value}`)
		.join('; ');
}

// Làm mới cookie mỗi 24 giờ
setInterval(refreshCookies, 24 * 60 * 60 * 1000);
