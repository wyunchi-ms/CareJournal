import { http } from '@kit.NetworkKit';

interface LlmHttpResult {
  ok: boolean;
  status: number;
  data: object | string;
  detail: string;
}

export async function postJson(
  url: string,
  serializedHeaders: string,
  body: string,
  connectTimeout: number,
  readTimeout: number
): Promise<string> {
  const client = http.createHttp();
  try {
    const response = await client.request(url, {
      method: http.RequestMethod.POST,
      header: JSON.parse(serializedHeaders) as Record<string, string>,
      extraData: body,
      connectTimeout,
      readTimeout,
      expectDataType: http.HttpDataType.STRING
    });
    const detail = String(response.result ?? '');
    let data: object | string = detail;
    try {
      data = JSON.parse(detail) as object;
    } catch (_) {
      // Preserve provider error bodies that are not JSON.
    }
    const result: LlmHttpResult = {
      ok: response.responseCode >= 200 && response.responseCode < 300,
      status: response.responseCode,
      data,
      detail
    };
    return JSON.stringify(result);
  } finally {
    client.destroy();
  }
}
