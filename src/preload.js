const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
	selectFolder: () => ipcRenderer.send('select-folder'),
	onFolderSelected: (callback) => ipcRenderer.on('folder-selected', (event, path) => callback(path)),
	downloadFile: (downloadInfo) => {
		return new Promise((resolve, reject) => {
			ipcRenderer.send('download-file', downloadInfo);

			ipcRenderer.once('download-file-success', (event, filePath) => {
				resolve(filePath);
			});

			ipcRenderer.once('download-file-error', (event, error) => {
				reject(error);
			});
		});
	},
	onDownloadProgress: (callback) => {
		ipcRenderer.on('download-progress', (event, progress) => {
			callback(progress);
		});
	},
	onDownloadStatus: (callback) => {
		ipcRenderer.on('download-status', (event, status) => {
			callback(status);
		});
	},
});
