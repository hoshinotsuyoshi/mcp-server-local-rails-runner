declare global {
	namespace NodeJS {
		interface ProcessEnv {
			RAILS_WORKING_DIR: string;
			PROJECT_NAME_AS_CONTEXT?: string;
		}
	}
}

export {};
