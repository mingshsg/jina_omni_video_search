import type { Locale } from './en';

export type { Locale };

/** UI copy keys shared by ZH/EN. */
export type UiMessages = {
  appTitle: string;
  appSubtitle: string;
  navSearch: string;
  navImageSearch: string;
  navImport: string;
  navLibrary: string;
  localeZh: string;
  localeEn: string;

  // Search
  searchPlaceholder: string;
  searchButton: string;
  modalityLabel: string;
  modalityBoth: string;
  modalityVisual: string;
  modalityAudio: string;
  variantLabel: string;
  variantAllHint: string;
  topKLabel: string;
  videoFilterLabel: string;
  videoFilterAll: string;
  resultsTitle: string;
  playerTitle: string;
  timelineTitle: string;
  noResults: string;
  searchEmptyHint: string;
  searchError: string;
  scoreLabel: string;
  scoreRrfLabel: string;
  scoreVisualLabel: string;
  scoreAudioLabel: string;
  sortByLabel: string;
  sortByRrf: string;
  sortByVisual: string;
  sortByAudio: string;
  sortByHelp: string;
  selectVariantFirst: string;
  loadingVariants: string;
  noVariants: string;
  seekingTo: string;

  // Image search
  imageSearchTitle: string;
  imageSearchSubtitle: string;
  imageUploadLabel: string;
  imageUploadHint: string;
  imageDropHint: string;
  imageSelectedLabel: string;
  imageClear: string;
  imageSearchButton: string;
  imageSearchEmptyHint: string;
  imageRequired: string;
  imageTypeError: string;

  // Ingest
  ingestTitle: string;
  ingestDescription: string;
  modeLabel: string;
  modeUrl: string;
  modeLocal: string;
  modeUpload: string;
  scopeLabel: string;
  scopeSingle: string;
  scopeBatch: string;
  batchModeLabel: string;
  batchModeUpload: string;
  batchModeFolder: string;
  batchUploadLabel: string;
  batchFolderLabel: string;
  batchFolderPlaceholder: string;
  batchFolderHelp: string;
  batchSubmit: string;
  batchProgressTitle: string;
  batchJobsLabel: string;
  batchDoneLabel: string;
  batchFailedLabel: string;
  batchPartialErrors: string;
  batchAllDone: string;
  clientBatchFilesRequired: string;
  clientBatchFolderRequired: string;
  urlLabel: string;
  urlPlaceholder: string;
  localLabel: string;
  localPlaceholder: string;
  uploadLabel: string;
  titleLabel: string;
  titlePlaceholder: string;
  autoStartLabel: string;
  autoStartHelp: string;
  chunkPresetSelectLabel: string;
  chunkPresetHelp: string;
  chunkPresetStandard: string;
  chunkPreset60s: string;
  chunkPreset30s: string;
  chunkPreset20s: string;
  chunkPresetFine: string;
  submitImport: string;
  confirmWorkload: string;
  cancelConfirm: string;
  progressTitle: string;
  workloadTitle: string;
  windowsLabel: string;
  inferenceCallsLabel: string;
  hasAudioLabel: string;
  chunkPresetLabel: string;
  stageLabel: string;
  statusLabel: string;
  windowsDoneLabel: string;
  windowsFailedLabel: string;
  throughputLabel: string;
  confirmNeeded: string;
  ingestSuccess: string;
  ingestFailed: string;
  /** Non-blocking banner after success auto-reset; `{title}` interpolated by UI. */
  lastImportSuccess: string;
  clientUrlRequired: string;
  clientLocalRequired: string;
  clientUploadRequired: string;
  yes: string;
  no: string;

  // Library
  libraryTitle: string;
  libraryDescription: string;
  libraryEmpty: string;
  libraryEmptyAction: string;
  colTitle: string;
  colStatus: string;
  colDuration: string;
  colVariants: string;
  colUpdated: string;
  colActions: string;
  actionRetry: string;
  actionRemove: string;
  actionSearch: string;
  removeConfirm: string;
  removeNote: string;
  chunksLabel: string;
  refresh: string;
  libraryError: string;
  retryStarted: string;
  removeDone: string;
};

export const uiEn: UiMessages = {
  appTitle: 'Jina Omni Video Search',
  appSubtitle: 'Find a moment by text · play from there',
  navSearch: 'Search',
  navImageSearch: 'Image search',
  navImport: 'Import',
  navLibrary: 'Library',
  localeZh: '中文',
  localeEn: 'EN',

  searchPlaceholder: 'a cat on a windowsill',
  searchButton: 'Search',
  modalityLabel: 'Modality',
  modalityBoth: 'Both',
  modalityVisual: 'Visual',
  modalityAudio: 'Audio',
  variantLabel: 'Variant',
  variantAllHint: 'Select an indexed variant',
  topKLabel: 'Top-k',
  videoFilterLabel: 'Video',
  videoFilterAll: 'All videos',
  resultsTitle: 'Results',
  playerTitle: 'Player',
  timelineTitle: 'Matches on this video',
  noResults: 'No matching moments.',
  searchEmptyHint: 'Enter a query and choose a variant to search.',
  searchError: 'Search failed',
  scoreLabel: 'Score',
  scoreRrfLabel: 'RRF',
  scoreVisualLabel: 'Visual',
  scoreAudioLabel: 'Audio',
  sortByLabel: 'Sort by',
  sortByRrf: 'RRF (fused)',
  sortByVisual: 'Visual',
  sortByAudio: 'Audio',
  sortByHelp:
    'RRF is fused rank. Visual and audio are knn similarity scores (cosine-related), not RRF.',
  selectVariantFirst: 'Choose a variant before searching.',
  loadingVariants: 'Loading variants…',
  noVariants: 'No ready variants yet. Import a video first.',
  seekingTo: 'Seek to',

  imageSearchTitle: 'Image search',
  imageSearchSubtitle: 'Upload a picture · find matching video moments',
  imageUploadLabel: 'Query image',
  imageUploadHint: 'JPEG, PNG, WebP, or GIF. Large images are resized automatically.',
  imageDropHint: 'Drop an image here, or click to choose a file',
  imageSelectedLabel: 'Selected',
  imageClear: 'Clear',
  imageSearchButton: 'Search with image',
  imageSearchEmptyHint: 'Upload an image and choose a variant to search.',
  imageRequired: 'Choose an image before searching.',
  imageTypeError: 'Please choose a JPEG, PNG, WebP, or GIF image.',

  ingestTitle: 'Import',
  ingestDescription: 'URL · local path · upload',
  modeLabel: 'Import mode',
  modeUrl: 'URL',
  modeLocal: 'Local path',
  modeUpload: 'Upload',
  scopeLabel: 'Import scope',
  scopeSingle: 'Single video',
  scopeBatch: 'Batch (one file = one movie)',
  batchModeLabel: 'Batch source',
  batchModeUpload: 'Multi-file upload',
  batchModeFolder: 'Local folder',
  batchUploadLabel: 'Video files',
  batchFolderLabel: 'Folder path',
  batchFolderPlaceholder: '/path/under/LOCAL_IMPORT_ROOT/…',
  batchFolderHelp:
    'Lists video files in that folder only (not recursive). Requires LOCAL_IMPORT_ROOT.',
  batchSubmit: 'Start batch',
  batchProgressTitle: 'Batch progress',
  batchJobsLabel: 'Jobs',
  batchDoneLabel: 'Completed',
  batchFailedLabel: 'Failed',
  batchPartialErrors: 'Some files were skipped',
  batchAllDone: 'Batch finished — ready for another.',
  clientBatchFilesRequired: 'Choose one or more video files.',
  clientBatchFolderRequired: 'Enter an absolute folder path.',
  urlLabel: 'Video URL',
  urlPlaceholder: 'https://…',
  localLabel: 'Absolute path',
  localPlaceholder: '/path/under/LOCAL_IMPORT_ROOT/…',
  uploadLabel: 'Video file',
  titleLabel: 'Title (optional)',
  titlePlaceholder: 'Display name',
  autoStartLabel: 'Start immediately',
  autoStartHelp: 'Off = show workload estimate and wait for confirm',
  chunkPresetSelectLabel: 'Chunk window',
  chunkPresetHelp:
    'Overlap keeps adjacent windows sharing a few seconds so cuts are not missed. standard 64s/4s · 60s/4s · 30s/4s · 20s/2s · fine 10s/2s. Each choice creates a distinct searchable variant.',
  chunkPresetStandard: 'standard — 64 s window / 4 s overlap (default)',
  chunkPreset60s: '60s — 60 s window / 4 s overlap',
  chunkPreset30s: '30s — 30 s window / 4 s overlap',
  chunkPreset20s: '20s — 20 s window / 2 s overlap',
  chunkPresetFine: 'fine — 10 s window / 2 s overlap',
  submitImport: 'Start import',
  confirmWorkload: 'Confirm and start',
  cancelConfirm: 'Dismiss',
  progressTitle: 'Progress',
  workloadTitle: 'Workload estimate',
  windowsLabel: 'Windows',
  inferenceCallsLabel: 'Inference calls',
  hasAudioLabel: 'Has audio',
  chunkPresetLabel: 'Chunk preset',
  stageLabel: 'Stage',
  statusLabel: 'Status',
  windowsDoneLabel: 'Done',
  windowsFailedLabel: 'Failed windows',
  throughputLabel: 'Throughput (windows/min)',
  confirmNeeded: 'Review the estimate, then confirm to start indexing.',
  ingestSuccess: 'Indexing complete',
  ingestFailed: 'Import failed',
  lastImportSuccess: 'Last import succeeded: {title}',
  clientUrlRequired: 'Enter a valid http(s) URL.',
  clientLocalRequired: 'Enter an absolute local path.',
  clientUploadRequired: 'Choose a video file to upload.',
  yes: 'Yes',
  no: 'No',

  libraryTitle: 'Library',
  libraryDescription: 'Indexed videos, variants, and status',
  libraryEmpty: 'No videos indexed yet.',
  libraryEmptyAction: 'Go to import',
  colTitle: 'Title',
  colStatus: 'Status',
  colDuration: 'Duration',
  colVariants: 'Variants',
  colUpdated: 'Updated',
  colActions: 'Actions',
  actionRetry: 'Re-index',
  actionRemove: 'Remove',
  actionSearch: 'Search',
  removeConfirm: 'Remove this video from the search index? Media files on disk are kept.',
  removeNote: 'Removes Elasticsearch docs only; files stay on disk.',
  chunksLabel: 'chunks',
  refresh: 'Refresh',
  libraryError: 'Could not load library',
  retryStarted: 'Re-index started',
  removeDone: 'Removed from index',
};

export const uiZh: UiMessages = {
  appTitle: 'Jina Omni 视频检索',
  appSubtitle: '用文本找到瞬间 · 从该处播放',
  navSearch: '检索',
  navImageSearch: '以图搜片',
  navImport: '导入',
  navLibrary: '片库',
  localeZh: '中文',
  localeEn: 'EN',

  searchPlaceholder: '窗台上的猫',
  searchButton: '检索',
  modalityLabel: '模态',
  modalityBoth: '视觉+音频',
  modalityVisual: '仅视觉',
  modalityAudio: '仅音频',
  variantLabel: '变体',
  variantAllHint: '选择已索引的变体',
  topKLabel: 'Top-k',
  videoFilterLabel: '视频',
  videoFilterAll: '全部视频',
  resultsTitle: '结果',
  playerTitle: '播放器',
  timelineTitle: '当前视频匹配片段',
  noResults: '没有匹配的瞬间。',
  searchEmptyHint: '输入查询并选择变体后检索。',
  searchError: '检索失败',
  scoreLabel: '得分',
  scoreRrfLabel: 'RRF',
  scoreVisualLabel: '视觉',
  scoreAudioLabel: '音频',
  sortByLabel: '排序',
  sortByRrf: 'RRF 融合',
  sortByVisual: '视觉',
  sortByAudio: '音频',
  sortByHelp:
    'RRF 为融合排名分；视觉/音频为 knn 相似度（与余弦相关），不是 RRF。',
  selectVariantFirst: '请先选择变体再检索。',
  loadingVariants: '正在加载变体…',
  noVariants: '尚无可用变体，请先导入视频。',
  seekingTo: '跳转到',

  imageSearchTitle: '以图搜片',
  imageSearchSubtitle: '上传图片 · 匹配视频画面瞬间',
  imageUploadLabel: '查询图片',
  imageUploadHint: '支持 JPEG、PNG、WebP、GIF；过大图片会自动压缩。',
  imageDropHint: '拖放图片到此处，或点击选择文件',
  imageSelectedLabel: '已选择',
  imageClear: '清除',
  imageSearchButton: '以图检索',
  imageSearchEmptyHint: '上传图片并选择变体后检索。',
  imageRequired: '请先选择图片再检索。',
  imageTypeError: '请选择 JPEG、PNG、WebP 或 GIF 图片。',

  ingestTitle: '导入',
  ingestDescription: 'URL · 本地路径 · 上传',
  modeLabel: '导入方式',
  modeUrl: 'URL',
  modeLocal: '本地路径',
  modeUpload: '上传',
  scopeLabel: '导入范围',
  scopeSingle: '单个视频',
  scopeBatch: '批量（一文件一部片）',
  batchModeLabel: '批量来源',
  batchModeUpload: '多文件上传',
  batchModeFolder: '本地文件夹',
  batchUploadLabel: '视频文件',
  batchFolderLabel: '文件夹路径',
  batchFolderPlaceholder: '/path/under/LOCAL_IMPORT_ROOT/…',
  batchFolderHelp:
    '仅列出该目录下的视频文件（不递归）。需要配置 LOCAL_IMPORT_ROOT。',
  batchSubmit: '开始批量导入',
  batchProgressTitle: '批量进度',
  batchJobsLabel: '任务',
  batchDoneLabel: '已完成',
  batchFailedLabel: '失败',
  batchPartialErrors: '部分文件已跳过',
  batchAllDone: '本批已完成 — 可以开始下一批。',
  clientBatchFilesRequired: '请选择一个或多个视频文件。',
  clientBatchFolderRequired: '请输入绝对文件夹路径。',
  urlLabel: '视频 URL',
  urlPlaceholder: 'https://…',
  localLabel: '绝对路径',
  localPlaceholder: '/path/under/LOCAL_IMPORT_ROOT/…',
  uploadLabel: '视频文件',
  titleLabel: '标题（可选）',
  titlePlaceholder: '显示名称',
  autoStartLabel: '立即开始',
  autoStartHelp: '关闭后先显示工作量估算，确认后再索引',
  chunkPresetSelectLabel: '分块窗口',
  chunkPresetHelp:
    '重叠段让相邻窗口共享若干秒，避免切点漏检。standard 64s/4s · 60s/4s · 30s/4s · 20s/2s · fine 10s/2s。每次选择会生成独立的可检索变体，便于对比。',
  chunkPresetStandard: 'standard — 64 秒窗口 / 4 秒重叠（默认）',
  chunkPreset60s: '60s — 60 秒窗口 / 4 秒重叠',
  chunkPreset30s: '30s — 30 秒窗口 / 4 秒重叠',
  chunkPreset20s: '20s — 20 秒窗口 / 2 秒重叠',
  chunkPresetFine: 'fine — 10 秒窗口 / 2 秒重叠',
  submitImport: '开始导入',
  confirmWorkload: '确认并开始',
  cancelConfirm: '关闭',
  progressTitle: '进度',
  workloadTitle: '工作量估算',
  windowsLabel: '窗口数',
  inferenceCallsLabel: '推理调用',
  hasAudioLabel: '含音频',
  chunkPresetLabel: '分块预设',
  stageLabel: '阶段',
  statusLabel: '状态',
  windowsDoneLabel: '已完成',
  windowsFailedLabel: '失败窗口',
  throughputLabel: '吞吐（窗/分钟）',
  confirmNeeded: '请查看估算，确认后开始索引。',
  ingestSuccess: '索引完成',
  ingestFailed: '导入失败',
  lastImportSuccess: '上次导入成功：{title}',
  clientUrlRequired: '请输入有效的 http(s) URL。',
  clientLocalRequired: '请输入绝对本地路径。',
  clientUploadRequired: '请选择要上传的视频文件。',
  yes: '是',
  no: '否',

  libraryTitle: '片库',
  libraryDescription: '已索引视频、变体与状态',
  libraryEmpty: '尚未索引任何视频。',
  libraryEmptyAction: '去导入',
  colTitle: '标题',
  colStatus: '状态',
  colDuration: '时长',
  colVariants: '变体',
  colUpdated: '更新时间',
  colActions: '操作',
  actionRetry: '重新索引',
  actionRemove: '移除',
  actionSearch: '检索',
  removeConfirm: '从检索索引中移除此视频？磁盘上的媒体文件会保留。',
  removeNote: '仅删除 Elasticsearch 文档；磁盘文件保留。',
  chunksLabel: '片段',
  refresh: '刷新',
  libraryError: '无法加载片库',
  retryStarted: '已开始重新索引',
  removeDone: '已从索引移除',
};

const uiMaps: Record<Locale, UiMessages> = {
  en: uiEn,
  zh: uiZh,
};

export function getUiMessages(locale: Locale): UiMessages {
  return uiMaps[locale] ?? uiEn;
}
