import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { profile, routineSummary, trainingSummary, scope } = await req.json();
    const apiKey = process.env.GOOGLE_API_KEY || '';
    if (!apiKey) return NextResponse.json({ error: 'Missing GOOGLE_API_KEY' }, { status: 503 });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });

    const { buildCoachPrompt } = await import('@/lib/coach.prompt');
    const result = await model.generateContent(
      buildCoachPrompt(profile, routineSummary, trainingSummary, scope)
    );
    const raw = result.response.text();

    try {
      const advice = JSON.parse(raw);
      return NextResponse.json({ advice }, { status: 200 });
    } catch {
      console.error('Coach JSON parse error. Raw:', raw);
      return NextResponse.json({ error: 'Bad JSON from model' }, { status: 502 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'coach_error' }, { status: 500 });
  }
}
