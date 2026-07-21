"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/lib/store";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  User, Mail, Shield, LogOut, Network, Code2, ImageIcon,
  MessageSquare, FileText, Mic, Search, ShieldAlert, Copy,
} from "lucide-react";
import { toast } from "sonner";

export function SettingsPanel() {
  const { user, logout } = useAuth();

  // Detect the current domain automatically (works on both Vercel and local)
  // SSR-safe: window is only available in the browser, so we initialize
  // lazily and read once on first client render.
  const origin = useMemo(() => {
    if (typeof window !== "undefined") return window.location.origin;
    return "";
  }, []);

  // Replace YOUR_DOMAIN placeholder with the actual domain in code examples.
  // The code templates use "https://YOUR_DOMAIN" — we replace the full
  // "https://YOUR_DOMAIN" with origin (which already includes https://) to
  // avoid "https://https://..." double-prefix.
  function fillDomain(code: string): string {
    if (!origin) return code;
    return code.replace(/https:\/\/YOUR_DOMAIN/g, origin);
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(fillDomain(code));
    toast.success("تم نسخ الكود");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">الإعدادات والوثائق</h1>
        <p className="text-muted-foreground text-sm">
          معلومات الحساب + دليل كامل لاستخدام البوابة مع كل أنواع الطلبات والمزودين
        </p>
      </div>

      {/* Account info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4" />
            معلومات الحساب
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row icon={<User className="w-4 h-4" />} label="الاسم" value={user?.name || "—"} />
          <Row icon={<Mail className="w-4 h-4" />} label="البريد" value={user?.email || "—"} ltr />
          <Row
            icon={<Shield className="w-4 h-4" />}
            label="الدور"
            value={<Badge variant="outline">{user?.role || "user"}</Badge>}
          />
        </CardContent>
      </Card>

      {/* Documentation tabs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Code2 className="w-4 h-4" />
            دليل الاستخدام الكامل
          </CardTitle>
          <CardDescription>
            البوابة شفافة تماماً — أرسل الطلب بنفس بنية المزود الأصلي، والبوابة تستبدل المفتاح فقط.
            {origin ? (
              <>دومينك الحالي: <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs" dir="ltr">{origin}</code> — استبدل <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs mx-1">gw_xxx</code> بمفتاحك الرئيسي.</>
            ) : (
              <>استبدل <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">gw_xxx</code> بمفتاحك الرئيسي.</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="chat">
            <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1 h-auto">
              <TabsTrigger value="chat" className="text-xs gap-1"><MessageSquare className="w-3 h-3" /> Chat</TabsTrigger>
              <TabsTrigger value="images" className="text-xs gap-1"><ImageIcon className="w-3 h-3" /> الصور</TabsTrigger>
              <TabsTrigger value="models" className="text-xs gap-1"><Search className="w-3 h-3" /> النماذج</TabsTrigger>
              <TabsTrigger value="embeddings" className="text-xs gap-1"><FileText className="w-3 h-3" /> Embeddings</TabsTrigger>
              <TabsTrigger value="audio" className="text-xs gap-1"><Mic className="w-3 h-3" /> الصوت</TabsTrigger>
              <TabsTrigger value="rerank" className="text-xs gap-1"><ShieldAlert className="w-3 h-3" /> Rerank</TabsTrigger>
              <TabsTrigger value="how" className="text-xs gap-1"><Network className="w-3 h-3" /> الآلية</TabsTrigger>
            </TabsList>

            {/* ── Chat ── */}
            <TabsContent value="chat" className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold">المحادثة (Chat Completions)</h3>
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15">
                  ✓ تم التحقق منه — يعمل فعلاً
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                البوابة تدعم كل مسارات chat الشائعة. أرسل الطلب بنفس بنية OpenAI أو المزود،
                والبوابة توجّهه تلقائياً للمزود الصحيح حسب اسم النموذج.
              </p>

              <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm">
                <div className="font-semibold mb-2 text-blue-600 dark:text-blue-400">
                  💡 مهم: ضع مسار المزود الصحيح في الإعدادات
                </div>
                <p className="text-muted-foreground mb-3">
                  البوابة تستخدم <b>مسار المزود</b> المُعدّ في لوحة التحكم (تبويب "المسارات")،
                  وليس مسار العميل. لذلك يجب أن تضيف مسار <code className="bg-muted px-1 rounded font-mono">chat</code> لكل مزود
                  بالمسار الفعلي الذي يتوقعه المزود:
                </p>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono w-32 justify-center">OpenAI</Badge>
                    <code className="font-mono">/v1/chat/completions</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono w-32 justify-center">yepapi</Badge>
                    <code className="font-mono">/v1/ai/chat</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono w-32 justify-center">kie.ai</Badge>
                    <code className="font-mono">/{"{model}"}/v1/chat/completions</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono w-32 justify-center">v0.dev</Badge>
                    <code className="font-mono">/v1/chats</code>
                  </div>
                </div>
                <p className="text-muted-foreground mt-3 text-xs">
                  العميل دائماً يطلب <code className="bg-muted px-1 rounded font-mono">/v1/chat/completions</code> والبوابة
                  تحوّله تلقائياً لمسار المزود الصحيح. لا حاجة لتعديل الكود.
                </p>
              </div>
              <EndpointPaths paths={[
                "/v1/chat/completions",
                "/v1/chats",
                "/v1/ai/chat",
                "/v1/messages",
              ]} />
              <CodeBlock
                title="✅ OpenAI-style (مُختبَر — gpt-4o وكل نماذج OpenAI)"
                code={`curl -X POST https://YOUR_DOMAIN/v1/chat/completions \\
  -H "Authorization: Bearer gw_xxx_YOUR_MASTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o",
    "messages": [{"role":"user","content":"مرحبا، كيف حالك؟"}]
  }'`}
                onCopy={copyCode}
                fillFn={fillDomain}
              />
              <CodeBlock
                title="✅ DeepSeek (مُختبَر — استخدم الاسم الكامل)"
                code={`curl -X POST https://YOUR_DOMAIN/v1/chat/completions \\
  -H "Authorization: Bearer gw_xxx_YOUR_MASTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-ai/DeepSeek-V3.2",
    "messages": [{"role":"user","content":"اكتب قصيدة قصيرة"}]
  }'`}
                onCopy={copyCode}
                fillFn={fillDomain}
              />
              <CodeBlock
                title="✅ Qwen / GLM / Claude (مُختبَر)"
                code={`curl -X POST https://YOUR_DOMAIN/v1/chat/completions \\
  -H "Authorization: Bearer gw_xxx_YOUR_MASTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "Qwen/Qwen3-32B",
    "messages": [{"role":"user","content":"اشرح الذكاء الاصطناعي في سطرين"}]
  }'`}
                onCopy={copyCode}
                fillFn={fillDomain}
              />
              <CodeBlock
                title="✅ Python (OpenAI SDK — يعمل مع كل النماذج)"
                code={`from openai import OpenAI

client = OpenAI(
    api_key="gw_xxx_YOUR_MASTER_KEY",
    base_url="https://YOUR_DOMAIN/v1"
)

# أي نموذج من قائمة /v1/models
resp = client.chat.completions.create(
    model="deepseek-ai/DeepSeek-V3.2",
    messages=[{"role":"user","content":"مرحبا"}]
)
print(resp.choices[0].message.content)`}
                onCopy={copyCode}
                fillFn={fillDomain}
              />
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-sm">
                <div className="font-semibold mb-1 text-blue-600 dark:text-blue-400">
                  💡 استخدم أسماء النماذج الصحيحة
                </div>
                <p className="text-muted-foreground">
                  استرجع قائمة النماذج المتاحة عبر <code className="font-mono">GET /v1/models</code> واستخدم
                  الاسم كما هو بالضبط (مثلاً <code className="font-mono">deepseek-ai/DeepSeek-V3.2</code> وليس
                  <code className="font-mono mx-1">deepseek-chat</code>).
                </p>
              </div>
            </TabsContent>

            {/* ── Images ── */}
            <TabsContent value="images" className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold">توليد الصور (Image Generation)</h3>
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15">
                  ✓ تم التحقق منه — يعمل فعلاً
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                البوابة تدعم توليد الصور من أي مزود. أرسل الطلب بنفس بنية المزود الأصلي —
                البوابة تستبدل المفتاح فقط وتُعيد الرد كما هو (شفافية كاملة).
              </p>
              <EndpointPaths paths={[
                "/v1/images/generations",
                "/v1/images/edits",
                "/v1/images/variations",
              ]} />

              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
                <div className="font-semibold mb-2 text-emerald-600 dark:text-emerald-400">
                  ✅ إعداد المزود لتوليد الصور
                </div>
                <p className="text-muted-foreground mb-2">
                  من تبويب "المزودون" → تفاصيل المزود → تبويب "المسارات"، أضف:
                </p>
                <ul className="text-muted-foreground space-y-1.5 text-xs mr-4">
                  <li>• <b>النوع:</b> <code className="font-mono">images</code></li>
                  <li>• <b>المسار:</b> مسار المزود الفعلي، مثال CometAPI:
                    <code className="font-mono block mt-1 bg-muted/50 p-1.5 rounded text-[11px]" dir="ltr">
                      /v1beta/models/gemini-3.1-flash-lite-image:generateContent
                    </code>
                  </li>
                  <li>• <b>النماذج:</b> أضف اسم النموذج في تبويب "النماذج"، مثال:
                    <code className="font-mono mr-1">gemini-3.1-flash-lite-image</code>
                  </li>
                  <li>• <b>طريقة المصادقة (CometAPI):</b> <code className="font-mono">raw</code> (بدون Bearer)،
                    الترويسة <code className="font-mono">Authorization</code>
                  </li>
                </ul>
              </div>

              <CodeBlock
                title="✅ CometAPI — Gemini Image (مُختبَر — يرجع صورة JPEG base64)"
                code={`curl -X POST https://YOUR_DOMAIN/v1/images/generations \\
  -H "Authorization: Bearer gw_xxx_YOUR_MASTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gemini-3.1-flash-lite-image",
    "contents": [{"role":"user","parts":[{"text":"a cute cat"}]}],
    "generationConfig": {"responseModalities":["TEXT","IMAGE"]}
  }'`}
                onCopy={copyCode}
                fillFn={fillDomain}
              />

              <CodeBlock
                title="✅ SiliconFlow — FLUX.1-schnell (مُختبَر — يرجع رابط صورة PNG)"
                code={`curl -X POST https://YOUR_DOMAIN/v1/images/generations \\
  -H "Authorization: Bearer gw_xxx_YOUR_MASTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "black-forest-labs/FLUX.1-schnell",
    "prompt": "قط فضائي يطير في الفضاء، digital art",
    "image_size": "1024x1024"
  }'`}
                onCopy={copyCode}
                fillFn={fillDomain}
              />

              <CodeBlock
                title="✅ SiliconFlow — Qwen-Image (مُختبَر)"
                code={`curl -X POST https://YOUR_DOMAIN/v1/images/generations \\
  -H "Authorization: Bearer gw_xxx_YOUR_MASTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "Qwen/Qwen-Image",
    "prompt": "لوحة فنية لمنظر طبيعي عند الغروب",
    "image_size": "1024x1024"
  }'`}
                onCopy={copyCode}
                fillFn={fillDomain}
              />

              <CodeBlock
                title="OpenAI DALL-E style (للمزودين الذين يدعمون dall-e-3 / gpt-image)"
                code={`curl -X POST https://YOUR_DOMAIN/v1/images/generations \\
  -H "Authorization: Bearer gw_xxx_YOUR_MASTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "dall-e-3",
    "prompt": "لوحة فنية لقط في غابة",
    "n": 1,
    "size": "1024x1024"
  }'`}
                onCopy={copyCode}
                fillFn={fillDomain}
              />

              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="font-semibold mb-2">بنية الرد (حسب المزود)</div>
                <div className="space-y-3">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">CometAPI / Gemini:</div>
                    <pre className="text-xs font-mono bg-background p-2 rounded overflow-x-auto" dir="ltr">{`{
  "candidates": [{
    "content": {
      "parts": [{
        "inlineData": {
          "mimeType": "image/jpeg",
          "data": "/9j/4AAQ... (base64)"
        }
      }]
    }
  }],
  "usageMetadata": {
    "promptTokenCount": 5,
    "candidatesTokenCount": 1518,
    "candidatesTokensDetails": [{"modality":"IMAGE","tokenCount":1120}]
  }
}`}</pre>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">SiliconFlow / OpenAI:</div>
                    <pre className="text-xs font-mono bg-background p-2 rounded overflow-x-auto" dir="ltr">{`{
  "images": [{"url": "https://s3.../image.png"}],
  "data": [{"url": "https://s3.../image.png"}]
}`}</pre>
                  </div>
                </div>
              </div>

              <CodeBlock
                title="✅ Python — حفظ الصورة (يدعم كل البنى)"
                code={`import requests, base64

resp = requests.post(
    "https://YOUR_DOMAIN/v1/images/generations",
    headers={
        "Authorization": "Bearer gw_xxx_YOUR_MASTER_KEY",
        "Content-Type": "application/json"
    },
    json={
        "model": "gemini-3.1-flash-lite-image",
        "contents": [{"role":"user","parts":[{"text":"a cute cat"}]}],
        "generationConfig": {"responseModalities":["TEXT","IMAGE"]}
    }
)
data = resp.json()

# CometAPI / Gemini style
if "candidates" in data:
    for part in data["candidates"][0]["content"]["parts"]:
        if "inlineData" in part:
            img = base64.b64decode(part["inlineData"]["data"])
            with open("image.jpg", "wb") as f:
                f.write(img)
            print("✓ تم حفظ image.jpg")

# SiliconFlow / OpenAI style
elif "images" in data and data["images"]:
    url = data["images"][0].get("url")
    if url:
        img = requests.get(url).content
        with open("image.png", "wb") as f:
            f.write(img)
        print("✓ تم حفظ image.png")
elif "data" in data and data["data"]:
    item = data["data"][0]
    if "b64_json" in item:
        img = base64.b64decode(item["b64_json"])
    elif "url" in item:
        img = requests.get(item["url"]).content
    with open("image.png", "wb") as f:
        f.write(img)
    print("✓ تم حفظ image.png")`}
                onCopy={copyCode}
                fillFn={fillDomain}
              />
            </TabsContent>

            {/* ── Models ── */}
            <TabsContent value="models" className="space-y-4">
              <div>
                <h3 className="font-semibold mb-1">قائمة النماذج (Models)</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  استرجع قائمة النماذج المتاحة من كل المزودين عبر مسار واحد.
                </p>
              </div>
              <EndpointPaths paths={["/v1/models"]} />
              <CodeBlock
                title="استرجاع قائمة النماذج"
                code={`curl https://YOUR_DOMAIN/v1/models \\
  -H "Authorization: Bearer gw_xxx_YOUR_MASTER_KEY"`}
                onCopy={copyCode}
                fillFn={fillDomain}
              />
              <p className="text-sm text-muted-foreground">
                <b>مهم:</b> استخدم أسماء النماذج كما تظهر في القائمة بالضبط (مثل
                <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs mx-1">deepseek-ai/DeepSeek-V3.2</code>
                وليس <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs mx-1">deepseek-chat</code>).
              </p>
            </TabsContent>

            {/* ── Embeddings ── */}
            <TabsContent value="embeddings" className="space-y-4">
              <div>
                <h3 className="font-semibold mb-1">التضمينات (Embeddings)</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  تحويل النصوص إلى متجهات للبحث الدلالي. أضف مسار
                  <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs mx-1">embeddings</code>
                  للمزود.
                </p>
              </div>
              <EndpointPaths paths={["/v1/embeddings"]} />
              <CodeBlock
                title="إنشاء embeddings"
                code={`curl -X POST https://YOUR_DOMAIN/v1/embeddings \\
  -H "Authorization: Bearer gw_xxx_YOUR_MASTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "text-embedding-3-small",
    "input": "النص المراد تضمينه"
  }'`}
                onCopy={copyCode}
                fillFn={fillDomain}
              />
            </TabsContent>

            {/* ── Audio ── */}
            <TabsContent value="audio" className="space-y-4">
              <div>
                <h3 className="font-semibold mb-1">الصوت (Audio — TTS / STT)</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  تحويل النص لصوت (TTS) أو الصوت لنص (STT). أضف مسار
                  <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs mx-1">audio</code>
                  للمزود.
                </p>
              </div>
              <EndpointPaths paths={[
                "/v1/audio/speech",
                "/v1/audio/transcriptions",
              ]} />
              <CodeBlock
                title="تحويل النص لصوت (TTS)"
                code={`curl -X POST https://YOUR_DOMAIN/v1/audio/speech \\
  -H "Authorization: Bearer gw_xxx_YOUR_MASTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "tts-1",
    "input": "مرحبا بك في البوابة الذكية",
    "voice": "alloy"
  }' --output speech.mp3`}
                onCopy={copyCode}
                fillFn={fillDomain}
              />
            </TabsContent>

            {/* ── Rerank ── */}
            <TabsContent value="rerank" className="space-y-4">
              <div>
                <h3 className="font-semibold mb-1">إعادة الترتيب (Rerank)</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  إعادة ترتيب المستندات حسب الصلة بسؤال. أضف مسار
                  <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs mx-1">rerank</code>
                  للمزود (مثل Cohere, SiliconFlow).
                </p>
              </div>
              <EndpointPaths paths={["/v1/rerank"]} />
              <CodeBlock
                title="Rerank"
                code={`curl -X POST https://YOUR_DOMAIN/v1/rerank \\
  -H "Authorization: Bearer gw_xxx_YOUR_MASTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "Qwen/Qwen3-Reranker-8B",
    "query": "ما هي البوابة الذكية؟",
    "documents": ["البوابة وسيط شفاف","الطقس اليوم مشمس"]
  }'`}
                onCopy={copyCode}
                fillFn={fillDomain}
              />
            </TabsContent>

            {/* ── How it works ── */}
            <TabsContent value="how" className="space-y-4">
              <div>
                <h3 className="font-semibold mb-1">آلية عمل البوابة</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  البوابة عبارة عن وكيل عكسي شفاف (Transparent Reverse Proxy) مع تدوير مفاتيح ذكي.
                </p>
              </div>
              <div className="space-y-3 text-sm">
                <Step n={1} title="وصول الطلب">
                  يصل الطلب إلى <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">/v1/*</code> مع مفتاحك الرئيسي.
                </Step>
                <Step n={2} title="اكتشاف النوع">
                  تتعرّف البوابة على نوع الـ Endpoint تلقائياً (chat, images, embeddings, audio...).
                </Step>
                <Step n={3} title="البحث عن المزود">
                  تبحث عن المزود الذي يدعم النموذج المطلوب (حسب النماذج المضافة لكل مزود).
                </Step>
                <Step n={4} title="التوجيه الشفاف">
                  تختار مفتاحاً صحيحاً وتُرسل الطلب بشفافية — <b>فقط استبدال المفتاح</b>، دون أي تعديل على الـ Body أو الـ Headers.
                </Step>
                <Step n={5} title="تدوير المفاتيح">
                  عند فشل المفتاح (حصة/حد/401/5xx) تنتقل للمفتاح التالي <b>خلال أجزاء من الثانية</b>، مع تخطي المفاتيح المعطّلة فوراً.
                </Step>
                <Step n={6} title="إعادة الرد">
                  تُعيد الرد كما هو من المزود — تطبيقك لا يشعر بأي فرق.
                </Step>
              </div>

              <div className="rounded-lg border bg-muted/30 p-4 mt-4">
                <div className="font-semibold mb-2">تصنيف الأخطاء والتدوير</div>
                <div className="space-y-1.5 text-xs">
                  <ErrRow code="401/403" action="تعطيل المفتاح نهائياً + الانتقال للتالي" />
                  <ErrRow code="429" action="Cooldown مؤقت (دقيقة) + الانتقال للتالي" />
                  <ErrRow code="402/Quota" action="Cooldown طويل (6 ساعات) + الانتقال للتالي" />
                  <ErrRow code="5xx" action="Cooldown قصير (5 ثوانٍ) + الانتقال للتالي" />
                  <ErrRow code="400/404/422" action="خطأ من العميل → يُعاد كما هو (شفافية)" />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Logout */}
      <Card className="border-destructive/30">
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <div className="font-medium">تسجيل الخروج</div>
            <div className="text-sm text-muted-foreground">إنهاء الجلسة الحالية</div>
          </div>
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              logout();
              toast.success("تم تسجيل الخروج");
            }}
          >
            <LogOut className="w-4 h-4 ml-2" />
            خروج
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────────── Sub-components ─────────────────────────

function Row({
  icon, label, value, ltr,
}: {
  icon: React.ReactNode; label: string; value: React.ReactNode; ltr?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2 border-b last:border-0">
      <div className="text-muted-foreground">{icon}</div>
      <div className="text-sm w-24 shrink-0">{label}</div>
      <div className="font-medium mr-auto" dir={ltr ? "ltr" : undefined}>{value}</div>
    </div>
  );
}

function EndpointPaths({ paths }: { paths: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {paths.map((p) => (
        <Badge key={p} variant="outline" className="font-mono text-xs" dir="ltr">{p}</Badge>
      ))}
    </div>
  );
}

function CodeBlock({ title, code, onCopy, fillFn }: { title: string; code: string; onCopy: (c: string) => void; fillFn?: (c: string) => string }) {
  const displayCode = fillFn ? fillFn(code) : code;
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onCopy(code)}
          title="نسخ"
        >
          <Copy className="w-3.5 h-3.5" />
        </Button>
      </div>
      <pre className="p-3 text-xs overflow-x-auto font-mono leading-relaxed bg-background" dir="ltr">
        {displayCode}
      </pre>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">
        {n}
      </div>
      <div className="flex-1 pt-0.5">
        <div className="font-medium">{title}</div>
        <div className="text-muted-foreground text-sm">{children}</div>
      </div>
    </div>
  );
}

function ErrRow({ code, action }: { code: string; action: string }) {
  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="font-mono text-xs w-20 justify-center" dir="ltr">{code}</Badge>
      <span className="text-muted-foreground">{action}</span>
    </div>
  );
}
