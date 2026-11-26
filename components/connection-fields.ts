"use client";
import type { ConfigScope } from "../lib/config-model";
export type Verification = {
  status: string;
  message: string;
  checkedAt?: string;
  jobId?: string;
  steps?: { step: string; message: string }[];
};
export type App = { id: string; name: string; apple: string; google: string };
type Field = {
  key: string;
  label: string;
  hint?: string;
  type?: "number";
  options?: string[];
};
export const definitions: Record<
  ConfigScope,
  {
    title: string;
    fields: Field[];
    secret: string;
    file?: string;
    defaults: Record<string, string | number>;
  }
> = {
  apple: {
    title: "Apple App Store Connect",
    fields: [
      { key: "issuerId", label: "Issuer ID" },
      { key: "keyId", label: "Key ID" },
      {
        key: "appId",
        label: "Apple 数字应用 ID",
        hint: "见 App Store Connect 的「App 信息」",
      },
      { key: "bundleId", label: "Bundle ID" },
      {
        key: "appPlatform",
        label: "应用平台",
        options: ["IOS", "MAC_OS", "TV_OS", "VISION_OS"],
      },
      {
        key: "version",
        label: "目标版本（可留空）",
        hint: "留空优先同步最新未上架版本，其次同步最新已上架版本。",
      },
    ],
    secret: "App Store Connect API 私钥（.p8）",
    file: ".p8",
    defaults: {
      issuerId: "",
      keyId: "",
      appId: "",
      bundleId: "",
      appPlatform: "IOS",
      version: "",
    },
  },
  google: {
    title: "Google Play",
    fields: [{ key: "packageName", label: "应用包名" }],
    secret: "Google 服务账号 JSON",
    file: ".json",
    defaults: { packageName: "" },
  },
  text: {
    title: "文本模型",
    fields: [
      {
        key: "baseUrl",
        label: "API Base URL",
        hint: "填写 OpenAI 兼容 API 的基础地址（通常以 /v1 结尾），不包含 /chat/completions",
      },
      {
        key: "model",
        label: "模型 ID",
        hint: "多个 ID 用英文逗号分隔，按从左到右的顺序验证和尝试。",
      },
      { key: "timeoutSeconds", label: "超时（秒，10–600）", type: "number" },
    ],
    secret: "文本模型 API Key",
    defaults: { baseUrl: "", model: "", timeoutSeconds: 120 },
  },
  image: {
    title: "图像模型",
    fields: [
      {
        key: "baseUrl",
        label: "API Base URL",
        hint: "填写 OpenAI 兼容 API 基础地址，不包含 /images/generations",
      },
      {
        key: "model",
        label: "模型 ID",
        hint: "多个 ID 用英文逗号分隔，按从左到右的顺序验证和尝试。",
      },
      { key: "timeoutSeconds", label: "超时（秒，10–600）", type: "number" },
    ],
    secret: "图像模型 API Key",
    defaults: { baseUrl: "", model: "", timeoutSeconds: 300 },
  },
};
export function settingsUrl(
  scope: ConfigScope,
  appId?: string,
  verify = false,
) {
  return `/api/settings/${scope}${verify ? "/verify" : ""}${appId ? `?appId=${encodeURIComponent(appId)}` : ""}`;
}
