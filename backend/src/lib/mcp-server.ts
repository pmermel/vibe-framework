import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { bootstrapFramework } from "../actions/bootstrap-framework.js";
import { createProject } from "../actions/create-project.js";
import { importProject } from "../actions/import-project.js";
import { configureRepo } from "../actions/configure-repo.js";
import { configureCloud } from "../actions/configure-cloud.js";
import { generateAssets } from "../actions/generate-assets.js";
import { capturePreview } from "../actions/capture-preview.js";
import { postStatus } from "../actions/post-status.js";

// ---------------------------------------------------------------------------
// Action registry — single source of truth for both REST and MCP dispatch
// ---------------------------------------------------------------------------

const actions: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  bootstrap_framework: bootstrapFramework,
  create_project: createProject,
  import_project: importProject,
  configure_repo: configureRepo,
  configure_cloud: configureCloud,
  generate_assets: generateAssets,
  capture_preview: capturePreview,
  post_status: postStatus,
};

// ---------------------------------------------------------------------------
// Tool definitions — JSON Schema derived from Zod schemas in each action
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "bootstrap_framework",
    description:
      "Repair and reconfigure the vibe-framework backend. Validates GitHub App auth, " +
      "OIDC trust, backend reachability, and Codespaces enablement. " +
      "Does NOT perform first-time setup — use init.sh for that.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "create_project",
    description:
      "Create a new GitHub repository from a vibe-framework template and open a " +
      "bootstrap PR with scaffold files. Org-owned repos use a GitHub App installation " +
      "token; user-owned repos require a PAT or user access token.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Short lowercase hyphenated repo name" },
        template: {
          type: "string",
          enum: ["nextjs", "react-vite", "node-api"],
          description: "Project scaffold template",
        },
        github_owner: { type: "string", description: "GitHub user or org that will own the repo" },
        approvers: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "GitHub usernames who can approve production deployments",
        },
        azure_region: {
          type: "string",
          description: "Azure region for deployed resources (default: eastus2)",
        },
        adapter: {
          type: "string",
          enum: ["container-app", "static-web-app"],
          description: "Deploy target adapter (default: container-app)",
        },
        framework_repo: {
          type: "string",
          description:
            "vibe-framework repo in owner/repo format to pin workflow refs against " +
            "(default: pmermel/vibe-framework)",
        },
      },
      required: ["name", "template", "github_owner", "approvers"],
      additionalProperties: false,
    },
  },
  {
    name: "import_project",
    description:
      "Adopt an existing GitHub repository into vibe-framework by opening a bootstrap " +
      "PR that adds vibe.yaml, workflow wrappers, and agent instruction files. " +
      "Does NOT modify the default branch directly.",
    inputSchema: {
      type: "object" as const,
      properties: {
        github_repo: {
          type: "string",
          description: "Existing repo in owner/repo format",
          pattern: "^[^/]+/[^/]+$",
        },
        adapter: {
          type: "string",
          enum: ["container-app", "static-web-app"],
          description: "Deploy target adapter (default: container-app)",
        },
        azure_region: {
          type: "string",
          description: "Azure region (default: eastus2)",
        },
        approvers: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "GitHub usernames who can approve production deployments",
        },
      },
      required: ["github_repo", "approvers"],
      additionalProperties: false,
    },
  },
  {
    name: "configure_repo",
    description:
      "Apply GitHub repository settings: branch protections, labels, environments " +
      "(preview/staging/production), and Azure OIDC secrets. " +
      "Does NOT configure required status checks (CI check names are only known after " +
      "bootstrap workflows are added). Does NOT create repos or provision Azure resources.",
    inputSchema: {
      type: "object" as const,
      properties: {
        github_repo: {
          type: "string",
          description: "Target repo in owner/repo format",
          pattern: "^[^/]+/[^/]+$",
        },
        approvers: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "GitHub usernames for production approval gate",
        },
        staging_branch: {
          type: "string",
          description: "Branch that triggers staging deploys (default: develop)",
        },
        production_branch: {
          type: "string",
          description: "Branch that triggers production deploys (default: main)",
        },
        azure_client_id: {
          type: "string",
          description: "Azure OIDC client ID output from configure_cloud",
        },
        azure_tenant_id: {
          type: "string",
          description: "Azure tenant ID output from configure_cloud",
        },
        azure_subscription_id: {
          type: "string",
          description: "Azure subscription ID output from configure_cloud",
        },
      },
      required: ["github_repo", "approvers"],
      additionalProperties: false,
    },
  },
  {
    name: "configure_cloud",
    description:
      "Provision Azure infrastructure for a project: resource group, Container Apps " +
      "environment, staging/production apps, and OIDC federated credentials. " +
      "Does NOT deploy the application or configure the GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_name: { type: "string", description: "Short project identifier" },
        github_repo: {
          type: "string",
          description: "Associated repo in owner/repo format",
          pattern: "^[^/]+/[^/]+$",
        },
        azure_region: {
          type: "string",
          description: "Azure region (default: eastus2)",
        },
        adapter: {
          type: "string",
          enum: ["container-app", "static-web-app"],
          description: "Deploy target adapter (default: container-app)",
        },
      },
      required: ["project_name", "github_repo"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_assets",
    description:
      "Generate visual assets for a project: favicons, Open Graph images, app icons, " +
      "and placeholder marketing graphics. Uploads to Azure Blob Storage or attaches " +
      "to the PR. Does NOT generate application source code.",
    inputSchema: {
      type: "object" as const,
      properties: {
        project_name: { type: "string", description: "Project identifier" },
        github_repo: {
          type: "string",
          description: "Target repo in owner/repo format",
          pattern: "^[^/]+/[^/]+$",
        },
        asset_types: {
          type: "array",
          items: {
            type: "string",
            enum: ["icon", "favicon", "og-image", "placeholder-marketing", "screenshot"],
          },
          description: "Asset types to generate (default: [favicon, og-image])",
        },
      },
      required: ["project_name", "github_repo"],
      additionalProperties: false,
    },
  },
  {
    name: "capture_preview",
    description:
      "Take a mobile screenshot of a deployed preview URL using Playwright and post it " +
      "as a comment on the GitHub PR. Default viewport is 390×844 (iPhone 14 Pro).",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: { type: "string", format: "uri", description: "Preview URL to screenshot" },
        github_repo: {
          type: "string",
          description: "Target repo in owner/repo format",
          pattern: "^[^/]+/[^/]+$",
        },
        pr_number: {
          type: "integer",
          minimum: 1,
          description: "PR number to post the screenshot comment on",
        },
        viewport: {
          type: "object",
          properties: {
            width: { type: "integer", minimum: 1 },
            height: { type: "integer", minimum: 1 },
          },
          description: "Viewport dimensions in pixels (default: 390×844)",
        },
      },
      required: ["url", "github_repo", "pr_number"],
      additionalProperties: false,
    },
  },
  {
    name: "post_status",
    description:
      "Post a pipeline status comment to a GitHub PR. Reports preview deployment " +
      "status, screenshot availability, or other pipeline events. " +
      "Does NOT merge, promote, or deploy.",
    inputSchema: {
      type: "object" as const,
      properties: {
        github_repo: {
          type: "string",
          description: "Target repo in owner/repo format",
          pattern: "^[^/]+/[^/]+$",
        },
        pr_number: {
          type: "integer",
          minimum: 1,
          description: "PR number to post the status comment on",
        },
        status: {
          type: "string",
          enum: ["pending", "success", "failure"],
          description: "Pipeline status",
        },
        message: { type: "string", description: "Human-readable status message" },
        preview_url: {
          type: "string",
          format: "uri",
          description: "Optional preview URL to include in the comment",
        },
      },
      required: ["github_repo", "pr_number", "status", "message"],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Factory — creates a fresh MCP Server for each request (stateless transport)
// ---------------------------------------------------------------------------

/**
 * createMcpServer
 *
 * Creates a configured MCP Server instance with all vibe-framework actions
 * registered as tools. Returns a fresh server to be paired with a
 * StreamableHTTPServerTransport for each incoming MCP request.
 *
 * Tool dispatch delegates to the same action handlers used by the REST
 * POST /action endpoint — no business logic is duplicated.
 *
 * Does NOT manage sessions or subscriptions — all requests are stateless.
 */
export function createMcpServer(): Server {
  const server = new Server(
    { name: "vibe-backend", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = actions[name];

    if (!handler) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
      };
    }

    try {
      const result = await handler((args ?? {}) as Record<string, unknown>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text" as const, text: message }],
      };
    }
  });

  return server;
}

export { TOOLS };
