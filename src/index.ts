import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
	ListResourcesRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { LocalRailsClient } from "./clients/localRailsClient.js";
import { CodeSnippetClient } from "./clients/codeSnippetClient.js";
import {
	dryRunMutate,
	executeMutate,
	executeReadOnly,
	dryRunMutateToolDefinition,
	executeMutateToolDefinition,
	executeReadOnlyToolDefinition,
	ExecuteReadOnlyArgs,
	DryRunMutateArgs,
	ExecuteMutateArgs,
} from "./tools/index.js";
import dotenv from "dotenv";
import { MutationAnalysisClient } from "./clients/mutationAnalysisClient.js";

// Load environment variables
dotenv.config();

// Environment validation
const envVars = z
	.object({
		RAILS_WORKING_DIR: z.string(),
		PROJECT_NAME_AS_CONTEXT: z.string().optional(),
	})
	.parse(process.env);

// Initialize clients
const railsClient = new LocalRailsClient();
const codeSnippetClient = new CodeSnippetClient();
const mutationAnalysisClient = new MutationAnalysisClient(railsClient);

// Initialize server
const server = new Server(
	{
		name: "local-rails-runner",
		version: "1.0.0",
		displayName: "Local Rails Runner",
		description: "A server for running Rails commands locally",
	},
	{
		capabilities: {
			tools: {
				executeReadOnly: true,
				dryRunMutate: true,
				executeMutate: true,
			},
			resources: {
				codeSnippets: true,
			},
		},
	}
);

// Tool implementations
server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [
		executeReadOnlyToolDefinition,
		dryRunMutateToolDefinition,
		executeMutateToolDefinition,
	],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;

	switch (name) {
		case executeReadOnlyToolDefinition.name:
			return executeReadOnly(args as ExecuteReadOnlyArgs, railsClient);

		case dryRunMutateToolDefinition.name:
			return dryRunMutate(
				args as DryRunMutateArgs,
				mutationAnalysisClient,
				codeSnippetClient
			);

		case executeMutateToolDefinition.name:
			return executeMutate(
				args as ExecuteMutateArgs,
				railsClient,
				codeSnippetClient
			);

		default:
			throw new Error(`Unknown tool: ${name}`);
	}
});

// Resource handlers for code snippets
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
	resources: Array.from(codeSnippetClient.getSnippets()).map(
		([id, snippet]) => ({
			uri: `snippet://${id}`,
			name: `Code Snippet ${id}`,
			mimeType: "text/plain",
			description: snippet.description,
		})
	),
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
	const id = request.params.uri.replace("snippet://", "");
	try {
		const snippet = await codeSnippetClient.getCodeSnippet(id);
		return {
			contents: [
				{
					uri: request.params.uri,
					text: snippet.code,
					mimeType: "text/plain",
				},
			],
		};
	} catch (error) {
		throw new Error(`Resource not found: ${request.params.uri}`);
	}
});

// Start server
async function main() {
	try {
		await railsClient.connect({
			workingDir: envVars.RAILS_WORKING_DIR,
		});
		const transport = new StdioServerTransport();
		await server.connect(transport);
		
		// Send initial server info
		process.stderr.write(JSON.stringify({
			type: "serverInfo",
			serverInfo: server.info,
		}) + "\n");
		
		console.error("Local Rails Runner MCP Server running");
	} catch (error) {
		console.error("Failed to start server:", error);
		process.exit(1);
	}
}

main();
