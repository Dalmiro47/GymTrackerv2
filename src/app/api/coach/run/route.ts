import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'nodejs'; // use Node on Vercel

export async function POST(req: NextRequest) {
  try {
    const hasKey = !!process.env.GOOGLE_API_KEY;
    console.log('coach/run: has GOOGLE_API_KEY?', hasKey);
    const { profile, routineSummary, trainingSummary } = await req.json();
    const apiKey = process.env.GOOGLE_API_KEY || '';
    if (!apiKey) return NextResponse.json({ error: 'Missing GOOGLE_API_KEY' }, { status: 503 });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { responseMimeType: 'application/json' },
    });

    const { buildCoachPrompt } = await import('@/lib/coach.prompt');
    const result = await model.generateContent(buildCoachPrompt(profile, routineSummary, trainingSummary));
    const raw = result.response.text();
    let advice;
    try {
      advice = JSON.parse(raw);
    } catch (e) {
      console.error('Coach JSON parse error. Raw:', raw);
      return NextResponse.json({ error: 'Bad JSON from model' }, { status: 502 });
    }
    return NextResponse.json({ advice }, { status: 200 });
  } catch (e:any) {
    return NextResponse.json({ error: e?.message ?? 'coach_error' }, { status: 500 });
  }
}
