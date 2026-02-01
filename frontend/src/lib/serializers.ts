/**
 * Serializers for API boundary transformations
 * 
 * Backend uses snake_case, frontend uses camelCase.
 * These functions handle the transformation at the API boundary.
 */

/**
 * Check if value is a plain object (not Date, File, Blob, etc.)
 * Only plain objects should have their keys transformed.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

/**
 * Transforms camelCase keys to snake_case for backend requests.
 * Handles: nested objects, arrays, Date objects
 * GUARDS: Only recurses into plain objects (not Date, File, Blob, etc.)
 */
export function toSnakeCase<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    
    // Handle Date objects → ISO string
    if (value instanceof Date) {
      result[snakeKey] = value.toISOString();
    // Only recurse into plain objects
    } else if (isPlainObject(value)) {
      result[snakeKey] = toSnakeCase(value);
    } else if (Array.isArray(value)) {
      result[snakeKey] = value.map(item => 
        item instanceof Date ? item.toISOString() :
        isPlainObject(item) ? toSnakeCase(item) : item
      );
    } else {
      result[snakeKey] = value;
    }
  }
  
  return result;
}

/**
 * Transforms snake_case keys to camelCase for frontend consumption.
 * GUARDS: Only recurses into plain objects (not Date, File, Blob, etc.)
 */
export function toCamelCase<T>(obj: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    
    // Only recurse into plain objects
    if (isPlainObject(value)) {
      result[camelKey] = toCamelCase(value);
    } else if (Array.isArray(value)) {
      result[camelKey] = value.map(item =>
        isPlainObject(item) ? toCamelCase(item) : item
      );
    } else {
      result[camelKey] = value;
    }
  }
  
  return result as T;
}
