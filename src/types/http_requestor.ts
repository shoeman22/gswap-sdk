type FetchReturnValue = Awaited<ReturnType<typeof fetch>>;

export interface HTTPResponse {
  ok: FetchReturnValue['ok'];
  status: FetchReturnValue['status'];
  json: FetchReturnValue['json'];
  text: FetchReturnValue['text'];
  headers?:
    | {
        get(name: string): string | null;
      }
    | Record<string, string | undefined>;
}

export type HttpRequestor = (
  uri: string,
  options?: Parameters<typeof fetch>[1],
) => Promise<HTTPResponse>;
