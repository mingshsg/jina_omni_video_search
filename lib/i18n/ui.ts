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
  navLive: string;
  localeZh: string;
  localeEn: string;

  // Search
  searchPlaceholder: string;
  searchButton: string;
  modalityLabel: string;
  modalityBoth: string;
  modalityAll: string;
  modalityVisual: string;
  modalityAudio: string;
  modalityDescription: string;
  variantLabel: string;
  variantAllHint: string;
  topKLabel: string;
  topKHelp: string;
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
  sortByHybrid: string;
  sortByHelp: string;
  hybridTextLabel: string;
  hybridTextHelp: string;
  parseQueryLabel: string;
  parseQueryHelp: string;
  parseDetailTitle: string;
  parseChipPromote: string;
  parseChipDismissAria: string;
  parseChipRestore: string;
  parseChipIgnoredCount: string;
  parseChipStatusBoosting: string;
  parseChipStatusNoEffect: string;
  parseChipStatusHybridOff: string;
  parseChipStatusSnapshotUnavailable: string;
  parseChipStatusHardFilter: string;
  parseChipStatusFilterMode: string;
  parseChipHintNoEffect: string;
  parseChipHintHybridOff: string;
  parseChipHintSnapshotUnavailable: string;
  parseChipFilterModeNote: string;
  parseImpliesHybridHint: string;
  facetsReset: string;
  facetsActiveHint: string;
  hybridDslTitle: string;
  hybridDslNotApplied: string;
  queryExplainButton: string;
  queryExplainTitle: string;
  queryExplainHelp: string;
  queryExplainRaw: string;
  queryExplainHybridOn: string;
  queryExplainHybridOff: string;
  queryExplainFiltersNone: string;
  scoreHybridLabel: string;
  metadataMatchBadge: string;
  selectVariantFirst: string;
  loadingVariants: string;
  noVariants: string;
  seekingTo: string;
  groupedMoments: string;
  groupedMomentsOne: string;
  facetsLabel: string;
  facetYearFrom: string;
  facetYearTo: string;
  facetYearInvalid: string;
  facetYearReversed: string;

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
  chunkPreset2s: string;
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
  actionEditMeta: string;
  removeConfirm: string;
  removeNote: string;
  chunksLabel: string;
  refresh: string;
  libraryError: string;
  retryStarted: string;
  removeDone: string;
  batchRemoveSelected: string;
  batchRemoveAll: string;
  batchRemoveConfirm: string;
  batchRemoveDone: string;
  selectedCount: string;
  metaLoading: string;
  metaLoadError: string;
  metaSaveError: string;
  metaConflict: string;
  metaReload: string;
  metaSave: string;
  metaWorkTitle: string;
  metaWorkTitleHelp: string;
  metaWorkTitleEn: string;
  metaWorkTitleZh: string;
  metaWorkTitleNative: string;
  metaWorkTitleSuggestEvidence: string;
  metaDescription: string;
  metaAbstract: string;
  metaYear: string;
  metaActors: string;
  metaActorsHelp: string;
  metaVideoType: string;
  metaLanguage: string;
  metaCountry: string;
  metaTags: string;
  metaTagsHelp: string;
  metaRevision: string;
  metaEmptyOption: string;
  metaSaved: string;
  metaSuggest: string;
  metaSuggesting: string;
  metaSuggestCancel: string;
  metaSuggestEmpty: string;
  metaSuggestWebUnavailable: string;
  metaSuggestApplied: string;
  metaSuggestActorCandidatesFound: string;
  metaSuggestError: string;
  metaSuggestTimeout: string;
  metaSuggestHelp: string;
  metaFieldSuggested: string;
  metaSuggestStageQueued: string;
  metaSuggestStagePreparing: string;
  metaSuggestStageResearching: string;
  metaSuggestStageValidating: string;
  metaSuggestStageHelp: string;
  metaActorCandidates: string;
  metaActorCandidateAdd: string;
  metaActorCandidateAdded: string;
  metaActorCandidateUnresolved: string;
  metaActorCandidateAddToCatalog: string;
  metaActorCandidateSource: string;
  metaActorCatalogAddError: string;
  metaSuggestReviewBelow: string;
  metaSuggestPendingApply: string;
  metaSuggestPendingValue: string;
  metaActorCandidateZh: string;
  metaActorCandidateNative: string;
  metaSuggestTraceTitle: string;
  metaSuggestTraceSearch: string;
  metaSuggestTraceRead: string;
  metaSuggestTraceQuestion: string;

  // Live video
  liveTitle: string;
  liveDescription: string;
  liveSessionTitle: string;
  liveSourcesTitle: string;
  liveRegisterSource: string;
  liveSourceNameLabel: string;
  liveSourceNamePlaceholder: string;
  liveConnectionRefLabel: string;
  liveConnectionRefPlaceholder: string;
  liveConnectionRefHelp: string;
  liveProtocolLabel: string;
  liveTransportLabel: string;
  liveSourceEnabled: string;
  liveCreateSource: string;
  liveRefreshSources: string;
  liveNoSources: string;
  liveStartSession: string;
  liveStopSession: string;
  liveOpenSession: string;
  liveValidationState: string;
  liveObservedState: string;
  liveDesiredState: string;
  liveWorkerAvailable: string;
  liveWorkerUnavailable: string;
  liveLagCapture: string;
  liveLagProcessing: string;
  liveQueueDepth: string;
  liveSpoolBytes: string;
  liveReconnects: string;
  liveWindowsSearchable: string;
  liveWindowsFailed: string;
  liveWindowsDropped: string;
  liveLastSearchable: string;
  liveLastMedia: string;
  liveFreshnessHint: string;
  liveNotSearchableYet: string;
  liveSearchTitle: string;
  liveFollowLabel: string;
  liveFollowHelp: string;
  liveFollowActive: string;
  liveFollowExpired: string;
  liveFollowStop: string;
  liveCacheHit: string;
  liveCacheMiss: string;
  liveImageSearch: string;
  liveTextSearch: string;
  liveClipPlayer: string;
  liveGatewayPlayer: string;
  liveGatewayUnavailable: string;
  liveGatewayOpen: string;
  liveMediaExpired: string;
  liveSelectSourceFirst: string;
  liveInvalidConnectionRef: string;
  liveSourceError: string;
  liveSessionError: string;
  liveBackToLive: string;
  liveEventsTitle: string;
  liveStateCreated: string;
  liveStateConnecting: string;
  liveStateLive: string;
  liveStateDegraded: string;
  liveStateStopping: string;
  liveStateStopped: string;
  liveStateFailed: string;
  liveValidationPending: string;
  liveValidationReady: string;
  liveValidationInvalid: string;
  liveEndpointLabel: string;
  liveVariantPinned: string;
  liveSessionIdLabel: string;
  liveSourceIdLabel: string;
  liveIdempotencyHint: string;
  liveDeleteSource: string;
  liveDeleteSourceConfirm: string;
  liveDeleteSourceHint: string;
  liveHideE2eSources: string;
  liveDeleteAllE2eSources: string;
  liveDeleteAllE2eConfirm: string;
  liveDeleteE2eDone: string;
};

export const uiEn: UiMessages = {
  appTitle: 'Jina Omni Video Search',
  appSubtitle: 'Find a moment by text · play from there',
  navSearch: 'Search',
  navImageSearch: 'Image search',
  navImport: 'Import',
  navLibrary: 'Library',
  navLive: 'Live',
  localeZh: '中文',
  localeEn: 'EN',

  searchPlaceholder: 'a cat on a windowsill',
  searchButton: 'Search',
  modalityLabel: 'Modality',
  modalityBoth: 'Both',
  modalityAll: 'All',
  modalityVisual: 'Visual',
  modalityAudio: 'Audio',
  modalityDescription: 'Description',
  variantLabel: 'Variant',
  variantAllHint: 'Select an indexed variant',
  topKLabel: 'Top-k',
  topKHelp: 'Result groups',
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
  sortByHybrid: 'Hybrid (text+vector)',
  sortByHelp: '',
  hybridTextLabel: 'Include text (hybrid)',
  hybridTextHelp:
    'Opt-in: BM25 over video metadata fused with vector ranks. Facet filters are optional — hybrid works with no filters. Default off = pure vector search.',
  parseQueryLabel: 'Smart parse',
  parseQueryHelp: '',
  parseDetailTitle: 'Parse detail',
  parseChipPromote: 'Use as filter',
  parseChipDismissAria: 'Ignore this parse',
  parseChipRestore: 'Restore',
  parseChipIgnoredCount: '{count} ignored',
  parseChipStatusBoosting: 'Boosting',
  parseChipStatusNoEffect: 'Not in current results',
  parseChipStatusHybridOff: 'Hybrid text is off',
  parseChipStatusSnapshotUnavailable: 'Could not verify',
  parseChipStatusHardFilter: 'Already filtered',
  parseChipStatusFilterMode: 'Always filtered (eval mode)',
  parseChipHintNoEffect:
    'No result in this batch matched — a boost can only re-rank what is already found. Use as filter re-scans the whole catalog and can still find matches.',
  parseChipHintHybridOff:
    'Smart parse ran without hybrid text on, so this was not scored. Use as filter does not need hybrid text — it filters directly.',
  parseChipHintSnapshotUnavailable:
    'Could not check this against the current results this time. Use as filter still applies it directly.',
  parseChipFilterModeNote:
    'QUERY_PARSER_FACET_MODE=filter — extracted facets are always applied as hard filters, not scored as boosts.',
  parseImpliesHybridHint:
    'Smart parse turns on Include text so extracted facets can boost hybrid ranking. Without hybrid, parses are reported only (hybrid_text_required). Detected chips: promote to a hard filter, or dismiss to ignore this parse.',
  hybridDslTitle: 'Hybrid / query DSL',
  hybridDslNotApplied:
    'Parse ran but hybrid text is off — BM25 and facet boosts were not sent to Elasticsearch.',
  queryExplainButton: 'Executed query',
  queryExplainTitle: 'Executed query',
  queryExplainHelp:
    'What this search actually sent and how it ranked. Hybrid does not require facet filters — only the “Include text” switch.',
  queryExplainRaw: 'Raw request + response meta',
  queryExplainHybridOn:
    'Hybrid text+vector (BM25 metadata fused with knn; filters optional)',
  queryExplainHybridOff: 'Pure vector (no BM25 text channel)',
  queryExplainFiltersNone: 'none (all eligible videos for this variant)',
  scoreHybridLabel: 'Hybrid',
  metadataMatchBadge: 'Video metadata matched',
  selectVariantFirst: 'Choose a variant before searching.',
  loadingVariants: 'Loading variants…',
  noVariants: 'No ready variants yet. Import a video first.',
  seekingTo: 'Seek to',
  groupedMoments: '{count} moments',
  groupedMomentsOne: '1 moment',

  facetsLabel: 'Filters',
  facetsReset: 'Reset filters',
  facetsActiveHint: 'Hard filters narrow eligible videos before ranking.',
  facetYearFrom: 'Year from',
  facetYearTo: 'Year to',
  facetYearInvalid: 'Year must be a whole number (e.g. 1960)',
  facetYearReversed: 'Year from must be ≤ year to',

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
    'Overlap keeps adjacent windows sharing a few seconds so cuts are not missed. standard 64s/4s · 60s/4s · 30s/4s · 20s/2s · fine 10s/2s · 2s/1s. Each choice creates a distinct searchable variant.',
  chunkPresetStandard: 'standard — 64 s window / 4 s overlap',
  chunkPreset60s: '60s — 60 s window / 4 s overlap',
  chunkPreset30s: '30s — 30 s window / 4 s overlap',
  chunkPreset20s: '20s — 20 s window / 2 s overlap',
  chunkPresetFine: 'fine — 10 s window / 2 s overlap',
  chunkPreset2s: '2s — 2 s window / 1 s overlap (default)',
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
  actionEditMeta: 'Edit metadata',
  removeConfirm: 'Remove this video from the search index? Media files on disk are kept.',
  removeNote: 'Removes Elasticsearch docs only; files stay on disk.',
  chunksLabel: 'chunks',
  refresh: 'Refresh',
  libraryError: 'Could not load library',
  retryStarted: 'Re-index started',
  removeDone: 'Removed from index',
  batchRemoveSelected: 'Remove selected',
  batchRemoveAll: 'Remove all',
  batchRemoveConfirm:
    'Remove {count} video(s) from the search index? Media files on disk are kept.',
  batchRemoveDone: 'Removed {removed} of {requested} from index',
  selectedCount: '{count} selected',
  metaLoading: 'Loading metadata…',
  metaLoadError: 'Could not load metadata',
  metaSaveError: 'Could not save metadata',
  metaConflict: 'Someone else saved first — reload and try again.',
  metaReload: 'Reload current metadata',
  metaSave: 'Save metadata',
  metaWorkTitle: 'Work title',
  metaWorkTitleHelp:
    'The actual production title — not the filename shown above.',
  metaWorkTitleEn: 'English title',
  metaWorkTitleZh: 'Chinese title (optional)',
  metaWorkTitleNative: 'Native-script title (optional)',
  metaWorkTitleSuggestEvidence: 'Top web search match for this title',
  metaDescription: 'Description',
  metaAbstract: 'Abstract',
  metaYear: 'Year',
  metaActors: 'Actors',
  metaActorsHelp:
    'Pick from the person catalog, or type a new name and press Enter (or click away) to add them.',
  metaVideoType: 'Video type',
  metaLanguage: 'Primary language',
  metaCountry: 'Production country/region',
  metaTags: 'Tags',
  metaTagsHelp: 'Comma-separated',
  metaRevision: 'Revision',
  metaEmptyOption: '—',
  metaSaved: 'Metadata saved',
  metaSuggest: 'Suggest',
  metaSuggesting: 'Suggesting…',
  metaSuggestCancel: 'Cancel suggest',
  metaSuggestEmpty: 'No local clues in the title (year / type / work name).',
  metaSuggestWebUnavailable:
    'Internet research did not complete — showing local title clues only.',
  metaSuggestApplied: 'Filled empty fields from available title and sourced work evidence. Review before Save.',
  metaSuggestActorCandidatesFound:
    'Actor candidates are ready for review; unresolved identities remain read-only.',
  metaSuggestError: 'Could not suggest metadata',
  metaSuggestTimeout: 'Suggest was stopped — you can still Save your draft.',
  metaSuggestHelp:
    'Suggest starts a background research request and keeps Save available. External work facts include source evidence and never overwrite fields you already filled.',
  metaFieldSuggested: 'Suggested',
  metaSuggestStageQueued: 'Suggest queued',
  metaSuggestStagePreparing: 'Preparing title clues',
  metaSuggestStageResearching: 'Agent is searching and reading public sources',
  metaSuggestStageValidating: 'Validating sources and structured fields',
  metaSuggestStageHelp:
    'This may take about a minute. You can keep editing or save the current draft while it runs.',
  metaActorCandidates: 'Sourced cast candidates for review',
  metaActorCandidateAdd: 'Add matched person',
  metaActorCandidateAdded: 'Added',
  metaActorCandidateUnresolved: 'Not in the controlled person catalog',
  metaActorCandidateAddToCatalog: 'Add to catalog',
  metaActorCandidateSource: 'source',
  metaActorCatalogAddError: 'Could not add this person to the catalog. Try again.',
  metaSuggestReviewBelow:
    'Suggestions are ready for review below — click + to apply.',
  metaSuggestPendingApply: 'Apply suggestion',
  metaSuggestPendingValue: 'Suggested value',
  metaActorCandidateZh: 'Chinese',
  metaActorCandidateNative: 'Native name',
  metaSuggestTraceTitle: 'Research call trace',
  metaSuggestTraceSearch: 'Searched',
  metaSuggestTraceRead: 'Read',
  metaSuggestTraceQuestion: 'Question asked',

  liveTitle: 'Live video',
  liveDescription:
    'Register an RTSP source by connection_ref, start a session, follow-search, play retained clips',
  liveSessionTitle: 'Live session',
  liveSourcesTitle: 'Sources',
  liveRegisterSource: 'Register source',
  liveSourceNameLabel: 'Display name',
  liveSourceNamePlaceholder: 'Lobby camera',
  liveConnectionRefLabel: 'Connection ref',
  liveConnectionRefPlaceholder: 'LIVE_SOURCE_DEMO_URL',
  liveConnectionRefHelp:
    'Names a worker-only env secret (LIVE_SOURCE_*_URL|CONNECTION). Never paste RTSP URLs or passwords here.',
  liveProtocolLabel: 'Protocol',
  liveTransportLabel: 'Transport',
  liveSourceEnabled: 'Enabled',
  liveCreateSource: 'Create source',
  liveRefreshSources: 'Refresh',
  liveNoSources: 'No live sources yet. Register one to begin.',
  liveStartSession: 'Start session',
  liveStopSession: 'Stop',
  liveOpenSession: 'Open',
  liveValidationState: 'Validation',
  liveObservedState: 'Observed',
  liveDesiredState: 'Desired',
  liveWorkerAvailable: 'Worker online',
  liveWorkerUnavailable: 'Worker unavailable',
  liveLagCapture: 'Capture lag',
  liveLagProcessing: 'Processing lag',
  liveQueueDepth: 'Queue depth',
  liveSpoolBytes: 'Spool',
  liveReconnects: 'Reconnects',
  liveWindowsSearchable: 'Searchable windows',
  liveWindowsFailed: 'Failed',
  liveWindowsDropped: 'Dropped',
  liveLastSearchable: 'Last searchable',
  liveLastMedia: 'Last media',
  liveFreshnessHint: 'Results update when a durable searchable event arrives.',
  liveNotSearchableYet: 'No searchable windows yet — waiting for indexing ack.',
  liveSearchTitle: 'Live search',
  liveFollowLabel: 'Follow',
  liveFollowHelp:
    'Keeps the query open and refreshes top-K when new windows become searchable.',
  liveFollowActive: 'Following',
  liveFollowExpired: 'Follow handle expired — search again.',
  liveFollowStop: 'Stop follow',
  liveCacheHit: 'Query vector cache hit',
  liveCacheMiss: 'Query vector cache miss',
  liveImageSearch: 'Image',
  liveTextSearch: 'Text',
  liveClipPlayer: 'Retained clip',
  liveGatewayPlayer: 'Live gateway view',
  liveGatewayUnavailable:
    'No MediaMTX HLS/WebRTC URL configured (optional LIVE_PLAYBACK_*_TEMPLATE).',
  liveGatewayOpen: 'Open gateway URL',
  liveMediaExpired: 'Retained media unavailable (410)',
  liveSelectSourceFirst: 'Choose a ready source first.',
  liveInvalidConnectionRef:
    'connection_ref must look like LIVE_SOURCE_NAME_URL or …_CONNECTION.',
  liveSourceError: 'Live source request failed',
  liveSessionError: 'Live session request failed',
  liveBackToLive: 'Back to live sources',
  liveEventsTitle: 'Session events',
  liveStateCreated: 'created',
  liveStateConnecting: 'connecting',
  liveStateLive: 'live',
  liveStateDegraded: 'degraded',
  liveStateStopping: 'stopping',
  liveStateStopped: 'stopped',
  liveStateFailed: 'failed',
  liveValidationPending: 'pending validation',
  liveValidationReady: 'ready',
  liveValidationInvalid: 'invalid',
  liveEndpointLabel: 'Endpoint',
  liveVariantPinned: 'Variant',
  liveSessionIdLabel: 'Session',
  liveSourceIdLabel: 'Source',
  liveIdempotencyHint: 'Each start uses a fresh idempotency key.',
  liveDeleteSource: 'Delete',
  liveDeleteSourceConfirm:
    'Delete this live source? Stop any active session first. Indexed windows are not cascade-deleted.',
  liveDeleteSourceHint: 'Removes the source registry entry only.',
  liveHideE2eSources: 'Hide app-e2e-* sources',
  liveDeleteAllE2eSources: 'Delete all e2e sources',
  liveDeleteAllE2eConfirm:
    'Delete every source whose name starts with app-e2e-? Active sessions must be stopped first.',
  liveDeleteE2eDone: 'E2E sources cleaned up',
};

export const uiZh: UiMessages = {
  appTitle: 'Jina Omni 视频检索',
  appSubtitle: '用文本找到瞬间 · 从该处播放',
  navSearch: '检索',
  navImageSearch: '以图搜片',
  navImport: '导入',
  navLibrary: '片库',
  navLive: '直播',
  localeZh: '中文',
  localeEn: 'EN',

  searchPlaceholder: '窗台上的猫',
  searchButton: '检索',
  modalityLabel: '模态',
  modalityBoth: '视觉+音频',
  modalityAll: '全部',
  modalityVisual: '仅视觉',
  modalityAudio: '仅音频',
  modalityDescription: '简介语义',
  variantLabel: '变体',
  variantAllHint: '选择已索引的变体',
  topKLabel: 'Top-k',
  topKHelp: '结果组数',
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
  sortByHybrid: '混合（文本+向量）',
  sortByHelp: '',
  hybridTextLabel: '纳入文本（混合检索）',
  hybridTextHelp:
    '可选开启：对视频元数据做 BM25，再与向量排序融合。筛选器是可选的——无筛选也可混合检索。默认关闭即为纯向量检索。',
  parseQueryLabel: '智能解析',
  parseQueryHelp: '',
  parseDetailTitle: '解析详情',
  parseChipPromote: '用作筛选',
  parseChipDismissAria: '忽略本次解析',
  parseChipRestore: '恢复',
  parseChipIgnoredCount: '已忽略 {count} 项',
  parseChipStatusBoosting: '正在 boost',
  parseChipStatusNoEffect: '当前结果中未命中',
  parseChipStatusHybridOff: '未开启纳入文本',
  parseChipStatusSnapshotUnavailable: '本次无法校验',
  parseChipStatusHardFilter: '已被硬筛选覆盖',
  parseChipStatusFilterMode: '始终硬筛选（评估模式）',
  parseChipHintNoEffect:
    '本轮候选结果里没有命中——boost 只能给已在候选池中的结果加权。用作筛选会重新扫描整个片库，仍可能找到匹配。',
  parseChipHintHybridOff:
    '智能解析在未开启纳入文本的情况下运行，因此未参与排序。用作筛选不依赖纳入文本，会直接生效。',
  parseChipHintSnapshotUnavailable:
    '本次未能校验该值与当前结果的匹配情况。用作筛选仍会直接生效。',
  parseChipFilterModeNote:
    'QUERY_PARSER_FACET_MODE=filter —— 抽取的 facet 始终作为硬筛选生效，不参与排序 boost。',
  parseImpliesHybridHint:
    '开启智能解析会同时打开「纳入文本」，以便抽取的 facet 参与混合排序 boost。未开 hybrid 时解析仅作报告（hybrid_text_required）。识别出的 chip：可升为硬筛选，或忽略本次解析。',
  hybridDslTitle: '混合检索 / 查询 DSL',
  hybridDslNotApplied:
    '已解析但未开启混合文本通道 — BM25 与 facet boost 未发送到 Elasticsearch。',
  queryExplainButton: '已执行查询',
  queryExplainTitle: '已执行查询',
  queryExplainHelp:
    '本次搜索实际发送的请求与排序方式。混合检索不依赖筛选器，只需打开「纳入文本」。',
  queryExplainRaw: '原始请求 + 响应 meta',
  queryExplainHybridOn: '混合文本+向量（BM25 元数据与 knn 融合；筛选可选）',
  queryExplainHybridOff: '纯向量（无 BM25 文本通道）',
  queryExplainFiltersNone: '无（该变体下全部就绪视频）',
  scoreHybridLabel: '混合',
  metadataMatchBadge: '视频元数据匹配',
  selectVariantFirst: '请先选择变体再检索。',
  loadingVariants: '正在加载变体…',
  noVariants: '尚无可用变体，请先导入视频。',
  seekingTo: '跳转到',
  groupedMoments: '{count} 个瞬间',
  groupedMomentsOne: '1 个瞬间',

  facetsLabel: '筛选',
  facetsReset: '重置筛选',
  facetsActiveHint: '硬筛选会在排序前缩小候选视频范围。',
  facetYearFrom: '起始年份',
  facetYearTo: '结束年份',
  facetYearInvalid: '年份须为整数（例如 1960）',
  facetYearReversed: '起始年份须 ≤ 结束年份',

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
    '重叠段让相邻窗口共享若干秒，避免切点漏检。standard 64s/4s · 60s/4s · 30s/4s · 20s/2s · fine 10s/2s · 2s/1s。每次选择会生成独立的可检索变体，便于对比。',
  chunkPresetStandard: 'standard — 64 秒窗口 / 4 秒重叠',
  chunkPreset60s: '60s — 60 秒窗口 / 4 秒重叠',
  chunkPreset30s: '30s — 30 秒窗口 / 4 秒重叠',
  chunkPreset20s: '20s — 20 秒窗口 / 2 秒重叠',
  chunkPresetFine: 'fine — 10 秒窗口 / 2 秒重叠',
  chunkPreset2s: '2s — 2 秒窗口 / 1 秒重叠（默认）',
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
  actionEditMeta: '编辑元数据',
  removeConfirm: '从检索索引中移除此视频？磁盘上的媒体文件会保留。',
  removeNote: '仅删除 Elasticsearch 文档；磁盘文件保留。',
  chunksLabel: '片段',
  refresh: '刷新',
  libraryError: '无法加载片库',
  retryStarted: '已开始重新索引',
  removeDone: '已从索引移除',
  batchRemoveSelected: '删除所选',
  batchRemoveAll: '全部删除',
  batchRemoveConfirm: '从检索索引中移除 {count} 个视频？磁盘上的媒体文件会保留。',
  batchRemoveDone: '已从索引移除 {removed}/{requested} 个',
  selectedCount: '已选 {count} 个',
  metaLoading: '正在加载元数据…',
  metaLoadError: '无法加载元数据',
  metaSaveError: '无法保存元数据',
  metaConflict: '他人已先保存 — 请重新加载后再试。',
  metaReload: '重新加载当前元数据',
  metaSave: '保存元数据',
  metaWorkTitle: '作品名称',
  metaWorkTitleHelp: '真正的作品/片名 —— 不是上方显示的文件名。',
  metaWorkTitleEn: '英文片名',
  metaWorkTitleZh: '中文片名（可选）',
  metaWorkTitleNative: '原文片名（可选）',
  metaWorkTitleSuggestEvidence: '网络搜索命中的首个片名',
  metaDescription: '简介',
  metaAbstract: '摘要',
  metaYear: '年份',
  metaActors: '演员',
  metaActorsHelp:
    '从人物目录选择;也可以直接输入新姓名,回车或点击别处即可作为新条目加入目录。',
  metaVideoType: '视频类型',
  metaLanguage: '主要语言',
  metaCountry: '制作国家/地区',
  metaTags: '标签',
  metaTagsHelp: '逗号分隔',
  metaRevision: '修订号',
  metaEmptyOption: '—',
  metaSaved: '元数据已保存',
  metaSuggest: '建议填写',
  metaSuggesting: '正在建议…',
  metaSuggestCancel: '取消建议',
  metaSuggestEmpty: '标题中没有可用的本地线索（年份/类型/作品名）。',
  metaSuggestWebUnavailable: '联网调研未完成——仅展示本地标题线索。',
  metaSuggestApplied: '已根据标题线索和有来源的作品资料填入空字段，请审核后再保存。',
  metaSuggestActorCandidatesFound:
    '已找到演员候选，请人工检查；未匹配到人物目录的候选只供参考。',
  metaSuggestError: '无法生成元数据建议',
  metaSuggestTimeout: '建议任务已停止——你仍可保存当前草稿。',
  metaSuggestHelp:
    '建议功能会启动后台资料查询，期间仍可继续编辑或保存。外部作品资料会附带来源，也不会覆盖已填写字段。',
  metaFieldSuggested: '建议',
  metaSuggestStageQueued: '建议任务已排队',
  metaSuggestStagePreparing: '正在整理标题线索',
  metaSuggestStageResearching: 'Agent 正在搜索并阅读公开资料',
  metaSuggestStageValidating: '正在校验来源和结构化字段',
  metaSuggestStageHelp: '此过程可能需要约一分钟；等待期间可以继续编辑或保存当前草稿。',
  metaActorCandidates: '待审核的有来源演员候选',
  metaActorCandidateAdd: '加入已匹配人物',
  metaActorCandidateAdded: '已加入',
  metaActorCandidateUnresolved: '尚未收录到受控人物目录',
  metaActorCandidateAddToCatalog: '加入目录',
  metaActorCandidateSource: '来源',
  metaActorCatalogAddError: '加入人物目录失败,请重试。',
  metaSuggestReviewBelow: '建议已准备好，请在下方查看并点击 + 采纳。',
  metaSuggestPendingApply: '采纳该建议',
  metaSuggestPendingValue: '建议值',
  metaActorCandidateZh: '中文名',
  metaActorCandidateNative: '本名',
  metaSuggestTraceTitle: '本次调用明细',
  metaSuggestTraceSearch: '搜索',
  metaSuggestTraceRead: '阅读',
  metaSuggestTraceQuestion: '提问',

  liveTitle: '直播视频',
  liveDescription:
    '用 connection_ref 注册 RTSP 源、启动会话、跟随检索、播放保留片段',
  liveSessionTitle: '直播会话',
  liveSourcesTitle: '直播源',
  liveRegisterSource: '注册直播源',
  liveSourceNameLabel: '显示名称',
  liveSourceNamePlaceholder: '大堂摄像头',
  liveConnectionRefLabel: '连接引用',
  liveConnectionRefPlaceholder: 'LIVE_SOURCE_DEMO_URL',
  liveConnectionRefHelp:
    '指向 worker 环境中的密钥名（LIVE_SOURCE_*_URL|CONNECTION）。切勿在此粘贴 RTSP URL 或密码。',
  liveProtocolLabel: '协议',
  liveTransportLabel: '传输',
  liveSourceEnabled: '启用',
  liveCreateSource: '创建直播源',
  liveRefreshSources: '刷新',
  liveNoSources: '尚无直播源，请先注册。',
  liveStartSession: '启动会话',
  liveStopSession: '停止',
  liveOpenSession: '打开',
  liveValidationState: '校验状态',
  liveObservedState: '观测状态',
  liveDesiredState: '期望状态',
  liveWorkerAvailable: 'Worker 在线',
  liveWorkerUnavailable: 'Worker 不可用',
  liveLagCapture: '采集延迟',
  liveLagProcessing: '处理延迟',
  liveQueueDepth: '队列深度',
  liveSpoolBytes: 'Spool',
  liveReconnects: '重连次数',
  liveWindowsSearchable: '可检索窗口',
  liveWindowsFailed: '失败',
  liveWindowsDropped: '丢弃',
  liveLastSearchable: '最近可检索',
  liveLastMedia: '最近媒体',
  liveFreshnessHint: '仅在收到 durable searchable 事件后刷新结果。',
  liveNotSearchableYet: '尚无可检索窗口 — 等待索引确认。',
  liveSearchTitle: '直播检索',
  liveFollowLabel: '跟随',
  liveFollowHelp: '保持查询打开；新窗口变为 searchable 时刷新 Top-K。',
  liveFollowActive: '跟随中',
  liveFollowExpired: '跟随句柄已过期 — 请重新检索。',
  liveFollowStop: '停止跟随',
  liveCacheHit: '查询向量缓存命中',
  liveCacheMiss: '查询向量缓存未命中',
  liveImageSearch: '图片',
  liveTextSearch: '文本',
  liveClipPlayer: '保留片段',
  liveGatewayPlayer: '网关实时画面',
  liveGatewayUnavailable:
    '未配置 MediaMTX HLS/WebRTC（可选 LIVE_PLAYBACK_*_TEMPLATE）。',
  liveGatewayOpen: '打开网关地址',
  liveMediaExpired: '保留媒体不可用（410）',
  liveSelectSourceFirst: '请先选择已就绪的直播源。',
  liveInvalidConnectionRef:
    'connection_ref 须形如 LIVE_SOURCE_NAME_URL 或 …_CONNECTION。',
  liveSourceError: '直播源请求失败',
  liveSessionError: '直播会话请求失败',
  liveBackToLive: '返回直播源列表',
  liveEventsTitle: '会话事件',
  liveStateCreated: '已创建',
  liveStateConnecting: '连接中',
  liveStateLive: '直播中',
  liveStateDegraded: '降级',
  liveStateStopping: '停止中',
  liveStateStopped: '已停止',
  liveStateFailed: '失败',
  liveValidationPending: '待校验',
  liveValidationReady: '就绪',
  liveValidationInvalid: '无效',
  liveEndpointLabel: '端点',
  liveVariantPinned: '变体',
  liveSessionIdLabel: '会话',
  liveSourceIdLabel: '源',
  liveIdempotencyHint: '每次启动使用新的幂等键。',
  liveDeleteSource: '删除',
  liveDeleteSourceConfirm:
    '删除此直播源？请先停止进行中的会话。索引窗口不会级联删除。',
  liveDeleteSourceHint: '仅删除源注册条目。',
  liveHideE2eSources: '隐藏 app-e2e-* 源',
  liveDeleteAllE2eSources: '删除全部 e2e 源',
  liveDeleteAllE2eConfirm:
    '删除所有名称以 app-e2e- 开头的源？若有活跃会话请先停止。',
  liveDeleteE2eDone: '已清理 e2e 源',
};

const uiMaps: Record<Locale, UiMessages> = {
  en: uiEn,
  zh: uiZh,
};

export function getUiMessages(locale: Locale): UiMessages {
  return uiMaps[locale] ?? uiEn;
}
