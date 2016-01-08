/// <reference path="../aws-sdk/aws-sdk.d.ts" />

declare module "s3" {
    import * as AWS from "aws-sdk";
    import * as events from "events";

    export interface S3ClientOptions {
        maxAsyncS3?: number;
        s3Client?: AWS.S3;
        s3Options?: any;
        s3RetryCount?: number;
        s3RetryDelay?: number;
        multipartUploadThreshold?: number;
        multipartUploadSize?: number;
        multipartDownloadThreshold?: number;
        multipartDownloadSize?: number;
    }

    type S3Params = AWS.s3.PutObjectRequest

    interface DeleteS3Options {
        Bucket: string;
        Delete: {
            Objects: Array<{Key: string, VersionId?: string}>,
            Quiet?: boolean
        };
        MFA?: string;
        RequestPayer?: string;
    }

    interface DownloadDirParams {
        localDir: string;
        s3Params: S3Params;
        deleteRemoved?: boolean;
        getS3Params?: any;
        followSymlinks?: boolean;
    }

    interface UploadDirParams extends DownloadDirParams {
        defaultContentType?: string;
    }

    interface ListDirParams {
        recursive?: boolean;
        s3Params?: {
            Bucket: string;
            Delimiter?: string;
            EncodingType?: string;
            Marker?: string;
            MaxKeys?: number;
            Prefix?: string;
        }
    }

    export interface ProgressEmitter extends events.EventEmitter {
        progressAmount: number;
        progressTotal: number;
        progressMd5Amount: number;
    }

    class Client {
        constructor(options: S3ClientOptions);

        deleteObjects(s3Params: DeleteS3Options): ProgressEmitter;
        uploadFile(params: {localFile: string, s3Params: AWS.s3.GetObjectRequest}): ProgressEmitter;
        downloadFile(params: {localFile: string, s3Params: S3Params}): ProgressEmitter;
        listObjects(params: ListDirParams): ProgressEmitter;
        uploadDir(params: UploadDirParams): ProgressEmitter;
        downloadDir(params: DownloadDirParams): ProgressEmitter;
        deleteDir(s3Params: S3Params): ProgressEmitter;
        copyObject(s3Params: S3Params): ProgressEmitter;
        moveObject(s3Params: S3Params): ProgressEmitter;
        downloadBuffer(s3Params: S3Params): ProgressEmitter;
        downloadStream(s3Params: S3Params): ProgressEmitter;

        s3: AWS.S3;
    }

    export function createClient(options: S3ClientOptions): Client;
    export var AWS: any;
    export var getPublicUrl: any;
    export var getPublicUrlHttp: any;

    export const MAX_PUTOBJECT_SIZE: number;
    export const MAX_DELETE_COUNT: number;
    export const MAX_MULTIPART_COUNT: number;
    export const MIN_MULTIPART_SIZE: number;
}