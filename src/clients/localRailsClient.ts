import { exec } from "child_process";
import { promisify } from "util";
import {
	MutationAnalysisClient,
	type MutationAnalysis,
} from "./mutationAnalysisClient.js";

const execAsync = promisify(exec);

interface ExecError extends Error {
	stdout: string;
	stderr: string;
}

export class LocalRailsClient {
	private connected: boolean;
	private workingDir: string;
	private mutationAnalysisClient: MutationAnalysisClient;

	constructor() {
		this.connected = false;
		this.workingDir = "";
		this.mutationAnalysisClient = new MutationAnalysisClient(this);
	}

	async connect(config: {
		workingDir: string;
	}): Promise<void> {
		try {
			// Check if directory exists
			await execAsync(`test -d "${config.workingDir}"`);
			this.workingDir = config.workingDir;
			this.connected = true;
		} catch (error) {
			this.connected = false;
			throw new Error(`Working directory '${config.workingDir}' does not exist`);
		}
	}

	private async executeCommand(command: string): Promise<string> {
		if (!this.connected) {
			throw new Error("Not connected to Rails environment");
		}

		// Add a clear delimiter for our output
		const OUTPUT_DELIMITER =
			"===RAILS_OUTPUT_DELIMITER_" +
			Math.random().toString(36).slice(2) +
			"===";

		try {
			const { stdout, stderr } = await execAsync(`
				cd "${this.workingDir}" &&
				RAILS_ENV=production bundle exec rails c <<-EOF
					begin
						result = ${command}
						puts "${OUTPUT_DELIMITER}"
						puts result.inspect
					rescue => e
						puts "${OUTPUT_DELIMITER}"
						puts "Error: #{e.message}"
						exit 1
					end
EOF
			`);

			// Add debug logging
			console.error("Command execution result:", {
				stdout,
				stderr,
			});

			return stdout;
		} catch (error) {
			const execError = error as ExecError;
			throw new Error(
				`Command failed.\nSTDOUT: ${execError.stdout}\nSTDERR: ${execError.stderr}`
			);
		}
	}

	async execute(code: string): Promise<string> {
		const result = await this.executeCommand(code);
		return this.parseResult(result);
	}

	async verifyReadOnly(code: string): Promise<boolean> {
		// List of keywords that indicate mutations
		const mutationKeywords = [
			"update",
			"delete",
			"destroy",
			"save",
			"create",
			"insert",
			"alter",
			"drop",
		];

		// Check for mutation keywords
		const containsMutation = mutationKeywords.some((keyword) =>
			code.toLowerCase().includes(keyword)
		);

		if (containsMutation) {
			return false;
		}

		// Additional analysis could be performed here
		return true;
	}

	async executeReadOnly(code: string): Promise<unknown> {
		const result = await this.executeCommand(code);
		return this.parseResult(result);
	}

	private parseResult(result: string): string {
		try {
			// Find the delimiter and take everything after it
			const parts = result.split(/===RAILS_OUTPUT_DELIMITER_[a-z0-9]+=== */);
			
			// Get the last part (after the delimiter)
			let output = parts[parts.length - 1].trim();
			
			// Remove any npm output or other noise that might appear
			output = output.split('\n')
				.filter(line => !line.startsWith('>'))
				.filter(line => line.trim() !== '')
				.join('\n');

			// Try to parse as JSON if it looks like JSON
			if (output.startsWith('{') || output.startsWith('[')) {
				try {
					const parsed = JSON.parse(output);
					return JSON.stringify(parsed);
				} catch (e) {
					// If JSON parsing fails, return as-is
					console.error("JSON parse error:", e);
				}
			}

			return output;
		} catch (error) {
			console.error("Parse error:", error);
			console.error("Raw result:", result);
			// If anything goes wrong, return the original trimmed string
			return result.trim();
		}
	}

	async disconnect(): Promise<void> {
		this.connected = false;
	}
} 