import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";

type HttpRequest = {
  method: string;
  path: string;
};

type HttpResponse = {
  status: (statusCode: number) => {
    json: (body: unknown) => void;
  };
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<HttpResponse>();
    const request = http.getRequest<HttpRequest>();

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      response.status(statusCode).json({
        statusCode,
        error: this.readHttpError(exception),
        path: request.path,
      });
      return;
    }

    this.logger.error(
      `${request.method} ${request.path} ${exception instanceof Error ? exception.name : "unknown error"}`,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: "Internal server error",
      path: request.path,
    });
  }

  private readHttpError(exception: HttpException): string | string[] {
    const payload = exception.getResponse();

    if (typeof payload === "string") {
      return payload;
    }

    if (
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload
    ) {
      const message = payload.message;
      if (typeof message === "string" || Array.isArray(message)) {
        return message;
      }
    }

    return "Request failed";
  }
}
