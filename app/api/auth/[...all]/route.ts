import { auth } from "../../../../lib/auth";
import { failure, privateHeaders } from "../../../../lib/http";
async function handler(request: Request) {
  try {
    const response = await auth().handler(request);
    for (const [key, value] of Object.entries(privateHeaders))
      response.headers.set(key, value);
    return response;
  } catch (error) {
    return failure(error);
  }
}
export { handler as GET, handler as POST };
