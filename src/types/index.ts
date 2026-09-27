export interface E2ECredentials {
	username: string;
	password: string;
}

/** Anchors loaded from .env.<TEST_ENV>. */
export interface E2EEnvironment {
	baseURL: string;
	/** Optional tenant / site / workspace (E2E_SITE_NAME). */
	siteName: string;
}
