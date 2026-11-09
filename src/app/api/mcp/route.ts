import { unauthorized } from '@/lib/mcp/auth';

// The MCP endpoint lives at /api/mcp/<MCP_ACCESS_KEY>; the bare path is always refused.
export const dynamic = 'force-dynamic';

const handler = async () => unauthorized();

export { handler as GET, handler as POST, handler as DELETE };
