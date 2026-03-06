export type ParsedSSEEvent = {
  id?: string;
  event?: string;
  data: string;
};

/**
 * Incremental SSE wire-format parser. Feed it chunks from a ReadableStream
 * and it returns fully parsed events. Handles partial chunk boundaries,
 * multiline data: fields, and comment lines (: keep-alive).
 */
export function createSSEParser() {
  let buffer = '';

  return {
    push(chunk: string): ParsedSSEEvent[] {
      buffer += chunk;
      const events: ParsedSSEEvent[] = [];
      const parts = buffer.split('\n\n');

      // Last part may be incomplete — keep in buffer
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        if (!part.trim()) continue;
        const event: ParsedSSEEvent = { data: '' };
        const lines = part.split('\n');
        for (const line of lines) {
          if (line.startsWith(':')) continue;
          const colonIdx = line.indexOf(':');
          if (colonIdx === -1) continue;
          const field = line.slice(0, colonIdx).trim();
          const value = line.slice(colonIdx + 1).trimStart();
          if (field === 'id') event.id = value;
          else if (field === 'event') event.event = value;
          else if (field === 'data')
            event.data += (event.data ? '\n' : '') + value;
          // retry: and other fields are intentionally ignored
        }
        if (event.data || event.event) events.push(event);
      }
      return events;
    },

    flush(): ParsedSSEEvent[] {
      if (!buffer.trim()) return [];
      const result = this.push('\n\n');
      buffer = '';
      return result;
    },
  };
}
