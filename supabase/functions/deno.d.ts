// The only parts of Deno that r2-access uses. The function is type-checked against this,
// so no Deno toolchain is needed in the repository.
declare const Deno: {
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
  env: { get(name: string): string | undefined };
};
