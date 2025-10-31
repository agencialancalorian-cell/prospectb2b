import React, { useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality, Type } from "@google/genai";

// --- Types ---
interface Creative {
  id: number;
  image: string; // data URL
  title: string;
  text: string;
  aspectRatio: string;
}

interface ReferenceFile {
  id: string;
  file: File;
  previewUrl: string;
}

interface FilePart {
  inlineData: {
    data: string; // base64
    mimeType: string;
  };
}

// --- Helper Functions ---
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

// --- React Components ---

const App = () => {
    const [formData, setFormData] = useState({
        product: '',
        audience: '',
        offer: '',
        adFormat: '1:1',
        toneOfVoice: 'Persuasivo',
    });
    const [referenceFiles, setReferenceFiles] = useState<ReferenceFile[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [creatives, setCreatives] = useState<Creative[]>([]);
    const [copiedStates, setCopiedStates] = useState<{ [key: string]: boolean }>({});

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };
    
    const handleFileChange = (files: FileList | null) => {
        if (!files) return;
        const newFiles = Array.from(files).map(file => ({
            id: `${file.name}-${file.lastModified}`,
            file,
            previewUrl: URL.createObjectURL(file),
        }));
        setReferenceFiles(prev => [...prev, ...newFiles]);
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.currentTarget.classList.add('drag-over');
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
    };
    
    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        handleFileChange(e.dataTransfer.files);
    };

    const removeFile = (id: string) => {
        setReferenceFiles(prev => prev.filter(file => file.id !== id));
    };

    const handleCopy = (text: string, key: string) => {
        navigator.clipboard.writeText(text);
        setCopiedStates(prev => ({ ...prev, [key]: true }));
        setTimeout(() => {
            setCopiedStates(prev => ({ ...prev, [key]: false }));
        }, 2000);
    };

    const generateCreatives = async () => {
        if (!formData.product || !formData.audience || referenceFiles.length === 0) {
            setError("Por favor, preencha todos os campos e envie pelo menos uma imagem de referência.");
            return;
        }
        setIsLoading(true);
        setError(null);
        setCreatives([]);

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            const referenceImageParts: FilePart[] = await Promise.all(
                referenceFiles.map(async (refFile) => {
                    const base64Data = await fileToBase64(refFile.file);
                    return {
                        inlineData: {
                            data: base64Data,
                            mimeType: refFile.file.type,
                        },
                    };
                })
            );

            // --- Generate Copy (Title and Text) ---
            const copyPrompt = `Você é um copywriter sênior, especialista em criar anúncios de alta conversão para a plataforma Meta (Facebook e Instagram).

Sua tarefa é gerar 6 variações de anúncios com base nas informações a seguir. Cada variação deve incluir um "título" (headline) e um "texto" principal.

**Contexto do Anúncio:**
- **Produto/Serviço:** ${formData.product}
- **Público-alvo:** ${formData.audience}
- **Oferta/Mensagem Principal:** ${formData.offer}
- **Tom de Voz Desejado:** ${formData.toneOfVoice}

**Instruções:**
1.  **Título (Headline):** Crie títulos curtos, diretos e que capturem a atenção imediatamente. Use no máximo 6 palavras.
2.  **Texto Principal:** Elabore um texto persuasivo que destaque os benefícios, crie uma conexão com o público-alvo e inclua uma chamada para ação (CTA) clara.
3.  **Linguagem:** Todo o conteúdo deve ser gerado em português do Brasil, com gramática e semântica impecáveis.
4.  **Políticas da Meta:** Siga rigorosamente todas as políticas de anúncios da Meta. Evite linguagem exagerada ou promessas irrealistas.

Entregue o resultado estritamente no formato JSON solicitado.`;

            const copyPromise = ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: copyPrompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            creatives: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        title: { type: Type.STRING, description: 'Um título curto e impactante para o anúncio (máximo 6 palavras).' },
                                        text: { type: Type.STRING, description: 'O texto principal e persuasivo para o anúncio.' },
                                    },
                                    required: ['title', 'text'],
                                }
                            }
                        },
                        required: ['creatives'],
                    }
                }
            });
            
            // --- Generate Images ---
            const toneToEmotionMap: { [key: string]: string } = {
                'Persuasivo': 'confiança e desejo',
                'Amigável & Casual': 'alegria e descontração',
                'Profissional & Confiável': 'seriedade e profissionalismo',
                'Ousado & Urgente': 'entusiasmo e urgência',
                'Divertido & bem-humorado': 'diversão e bom humor',
            };
            const desiredEmotion = toneToEmotionMap[formData.toneOfVoice] || 'confiança e desejo';

            const formatDescriptions: { [key: string]: string } = {
                '1:1': 'uma proporção de aspecto quadrada de 1:1, ideal para o feed',
                '9:16': 'uma proporção de aspecto vertical de 9:16, perfeita para Stories e Reels',
                '1.91:1': 'uma proporção de aspecto de paisagem 1.91:1, otimizada para anúncios de link'
            };
            
            const imagePromptText = `Você é um diretor de arte especialista em criar imagens de alta performance para anúncios em Meta Ads. Sua tarefa é criar uma imagem estática, fotorrealista e de altíssima qualidade com ${formatDescriptions[formData.adFormat]}.

A imagem deve ser para um anúncio sobre:
- **Produto/Serviço:** ${formData.product}
- **Público-alvo:** ${formData.audience}
- **Mensagem Principal:** ${formData.offer}

**Diretrizes Visuais:**
- **Estilo e Emoção:** A estética deve ser moderna, limpa e profissional, evocando um sentimento de ${desiredEmotion}. A imagem precisa capturar a atenção imediatamente.
- **Iluminação:** A iluminação deve ser vibrante e bem planejada, como em uma fotografia de estúdio, destacando as qualidades do produto ou o benefício principal.
- **Referências:** Use as imagens fornecidas como sua principal inspiração e referência para a composição, layout, paleta de cores e estilo geral. A imagem gerada deve ter uma qualidade e estrutura visual profissional semelhante, mas ser uma criação totalmente nova e original.

**Restrições Importantes:**
- **Não copie** elementos ou textos diretamente das imagens de referência.
- Se algum texto for absolutamente necessário na imagem, ele deve ser curto, impactante, legível e estar em perfeito português do Brasil.

O resultado final deve ser um criativo visualmente impactante, polido e pronto para ser publicado em uma campanha de Meta Ads de sucesso.`;

            const imagePromises = Array(6).fill(0).map(() => {
                const textPart = { text: imagePromptText };
                return ai.models.generateContent({
                    model: 'gemini-2.5-flash-image',
                    contents: { parts: [textPart, ...referenceImageParts] },
                    config: {
                        responseModalities: [Modality.IMAGE],
                    },
                });
            });

            const [copyResponse, ...imageResponses] = await Promise.all([copyPromise, ...imagePromises]);
            
            const copyData = JSON.parse(copyResponse.text);
            const generatedCreatives: Creative[] = [];
            
            for(let i=0; i < 6; i++) {
                const imageResponse = imageResponses[i];
                const imagePart = imageResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
                if (imagePart && imagePart.inlineData && copyData.creatives[i]) {
                    const base64ImageBytes = imagePart.inlineData.data;
                    const mimeType = imagePart.inlineData.mimeType;
                    const imageUrl = `data:${mimeType};base64,${base64ImageBytes}`;
                    
                    generatedCreatives.push({
                        id: i,
                        image: imageUrl,
                        title: copyData.creatives[i].title,
                        text: copyData.creatives[i].text,
                        aspectRatio: formData.adFormat,
                    });
                } else {
                    throw new Error(`Falha ao gerar a variação do criativo ${i + 1}.`);
                }
            }
            
            setCreatives(generatedCreatives);

        } catch (e) {
            console.error(e);
            setError("Ocorreu um erro ao gerar os criativos. Por favor, verifique o console para mais detalhes e tente novamente.");
        } finally {
            setIsLoading(false);
        }
    };

    const isFormIncomplete = !formData.product || !formData.audience || referenceFiles.length === 0;
    
    const getAspectRatioClass = (ratio: string) => {
        return `aspect-ratio-${ratio.replace(':', '-').replace('.', '_')}`;
    }

    return (
        <main>
            <h1>Gerador de Criativos para Meta Ads</h1>
            <h2>Criado por Marketing para Higienizadores</h2>

            <div className="container">
                <div className="form-grid">
                    <div className="form-group">
                        <label htmlFor="product">Nome do Produto/Serviço</label>
                        <input type="text" id="product" name="product" value={formData.product} onChange={handleInputChange} placeholder="Ex: 'Grãos de Café Artesanal'" aria-required="true" />
                    </div>
                    <div className="form-group">
                        <label htmlFor="audience">Público-alvo</label>
                        <input type="text" id="audience" name="audience" value={formData.audience} onChange={handleInputChange} placeholder="Ex: 'Jovens profissionais, amantes de café'" aria-required="true" />
                    </div>
                     <div className="form-group">
                        <label htmlFor="adFormat">Formato do Anúncio</label>
                        <select id="adFormat" name="adFormat" value={formData.adFormat} onChange={handleInputChange}>
                            <option value="1:1">Quadrado (1:1) - Ideal para Feed</option>
                            <option value="9:16">Retrato (9:16) - Perfeito para Stories & Reels</option>
                            <option value="1.91:1">Paisagem (1.91:1) - Otimizado para Anúncios de Link</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label htmlFor="toneOfVoice">Tom de Voz</label>
                        <select id="toneOfVoice" name="toneOfVoice" value={formData.toneOfVoice} onChange={handleInputChange}>
                            <option value="Persuasivo">Persuasivo (Padrão)</option>
                            <option value="Amigável & Casual">Amigável & Casual</option>
                            <option value="Profissional & Confiável">Profissional & Confiável</option>
                            <option value="Ousado & Urgente">Ousado & Urgente</option>
                            <option value="Divertido & bem-humorado">Divertido & bem-humorado</option>
                        </select>
                    </div>
                    <div className="form-group full-width">
                        <label htmlFor="offer">Oferta / Mensagem Principal</label>
                        <textarea id="offer" name="offer" value={formData.offer} onChange={handleInputChange} placeholder="Ex: '20% de desconto no primeiro pedido. Torrado na hora, de origem ética.'"></textarea>
                    </div>
                    <div className="form-group full-width">
                        <label>Imagens de Referência (para layout e estilo)</label>
                        <div 
                            className="drop-zone"
                            role="button"
                            tabIndex={0}
                            onClick={() => fileInputRef.current?.click()}
                            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInputRef.current?.click()}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            aria-label="Enviar imagens de referência"
                        >
                            <p>Arraste e solte os arquivos aqui, ou <span>clique para procurar</span>.</p>
                            <input 
                                type="file" 
                                ref={fileInputRef} 
                                hidden 
                                multiple 
                                accept="image/*"
                                onChange={(e) => handleFileChange(e.target.files)}
                            />
                        </div>
                        {referenceFiles.length > 0 && (
                            <div className="file-previews" aria-live="polite">
                                {referenceFiles.map(refFile => (
                                    <div key={refFile.id} className="preview-item">
                                        <img src={refFile.previewUrl} alt={refFile.file.name} />
                                        <button className="remove-file" onClick={() => removeFile(refFile.id)} aria-label={`Remover ${refFile.file.name}`}>&times;</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="form-group full-width">
                         <button className="generate-button" onClick={generateCreatives} disabled={isLoading || isFormIncomplete}>
                            {isLoading ? 'Gerando...' : 'Gerar 6 Criativos'}
                        </button>
                    </div>
                </div>
                 {error && <p className="error-message" role="alert">{error}</p>}
            </div>
            
            {isLoading && (
                <div className="loader" aria-label="Gerando criativos" aria-live="assertive">
                    <div className="spinner"></div>
                    <p>A IA está fazendo sua mágica... Criando imagens e textos.</p>
                </div>
            )}
            
            {creatives.length > 0 && (
                <section className="results-grid" aria-labelledby="results-heading">
                  <h2 id="results-heading" className="sr-only">Criativos Gerados</h2>
                    {creatives.map(creative => (
                        <div key={creative.id} className="creative-card">
                            <div className={`image-container ${getAspectRatioClass(creative.aspectRatio)}`}>
                                <img src={creative.image} alt={`Criativo Gerado ${creative.id + 1}`} />
                            </div>
                            <div className="card-content">
                                <h3>Variação do Criativo {creative.id + 1}</h3>
                                <div className="text-group">
                                    <label id={`title-label-${creative.id}`}>Título</label>
                                    <button className={`copy-button ${copiedStates[`title-${creative.id}`] ? 'copied' : ''}`} onClick={() => handleCopy(creative.title, `title-${creative.id}`)} aria-label="Copiar título">
                                       <svg viewBox="0 0 24 24" role="img" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"></path></svg>
                                    </button>
                                    <div className="text-content" aria-labelledby={`title-label-${creative.id}`}>{creative.title}</div>
                                </div>
                                <div className="text-group">
                                    <label id={`text-label-${creative.id}`}>Texto Principal</label>
                                    <button className={`copy-button ${copiedStates[`text-${creative.id}`] ? 'copied' : ''}`} onClick={() => handleCopy(creative.text, `text-${creative.id}`)} aria-label="Copiar texto principal">
                                       <svg viewBox="0 0 24 24" role="img" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"></path></svg>
                                    </button>
                                    <div className="text-content" aria-labelledby={`text-label-${creative.id}`}>{creative.text}</div>
                                </div>
                            </div>
                        </div>
                    ))}
                </section>
            )}
        </main>
    );
};


const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}