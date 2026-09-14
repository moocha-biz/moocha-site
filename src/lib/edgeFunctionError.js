// supabase-js's functions.invoke() throws before reading the response body
// on any non-2xx status, so `error.message` is always the generic "Edge
// Function returned a non-2xx status code" — the function's own
// {error: "..."} JSON body only lives in error.context, unread.
export async function edgeFunctionErrorMessage(data, error, fallback = 'Something went wrong - try again') {
  if (data?.error) return data.error;
  if (error?.context?.json) {
    try {
      const body = await error.context.json();
      if (body?.error) return body.error;
    } catch {
      // response body wasn't JSON (or already consumed) - fall through
    }
  }
  return error?.message || fallback;
}
