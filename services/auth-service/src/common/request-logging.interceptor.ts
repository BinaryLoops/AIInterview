import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from "@nestjs/common";
import { type Observable, tap } from "rxjs";

type HttpRequest = {
  method: string;
  path: string;
};

type HttpResponse = {
  statusCode: number;
};

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = http.getResponse<HttpResponse>();
          this.logger.log(
            `${request.method} ${request.path} ${response.statusCode} ${Date.now() - startedAt}ms`,
          );
        },
        error: () => {
          this.logger.warn(
            `${request.method} ${request.path} failed ${Date.now() - startedAt}ms`,
          );
        },
      }),
    );
  }
}
