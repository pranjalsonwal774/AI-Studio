import os
import torch
import numpy as np
from PIL import Image
import cv2
from typing import Dict, Any, List, Tuple
from backend.core.config import settings
from backend.utils.logger import logger

class AnimePortraitGenerator:
    def __init__(self):
        self.device = settings.DEVICE
        self.pipeline = None
        self.face_app = None
        
        if settings.MOCK_INFERENCE:
            logger.info("AnimePortraitGenerator initialized in Mock Mode (no PyTorch weights loaded).")
            return
            
        try:
            from diffusers import StableDiffusionXLInstantIDPipeline, ControlNetModel
            from insightface.app import FaceAnalysis
            
            logger.info("Initializing InsightFace for identity embeddings extraction...")
            # Initialize InsightFace FaceAnalysis
            self.face_app = FaceAnalysis(
                name='antelopev2', 
                root=settings.MODEL_CACHE_DIR, 
                providers=['CUDAExecutionProvider', 'CPUExecutionProvider'] if settings.DEVICE == "cuda" else ['CPUExecutionProvider']
            )
            self.face_app.prepare(ctx_id=0, det_size=(640, 640))
            logger.info("InsightFace prepared successfully.")

            # Initialize ControlNet model for InstantID
            logger.info(f"Loading InstantID ControlNet from {settings.INSTANTID_MODEL}...")
            controlnet = ControlNetModel.from_pretrained(
                settings.INSTANTID_MODEL,
                subfolder="ControlNetModel",
                torch_dtype=torch.float16 if self.device == "cuda" else torch.float32,
                cache_dir=settings.MODEL_CACHE_DIR
            )

            # Initialize main Animagine XL SDXL Pipeline with InstantID ControlNet
            logger.info(f"Loading Animagine XL Base Model from {settings.ANIMAGINE_MODEL}...")
            self.pipeline = StableDiffusionXLInstantIDPipeline.from_pretrained(
                settings.ANIMAGINE_MODEL,
                controlnet=controlnet,
                torch_dtype=torch.float16 if self.device == "cuda" else torch.float32,
                cache_dir=settings.MODEL_CACHE_DIR
            )
            
            # Use DPM++ 2M Karras Scheduler
            from diffusers import DPMSolverMultistepScheduler
            self.pipeline.scheduler = DPMSolverMultistepScheduler.from_config(
                self.pipeline.scheduler.config,
                use_karras_sigmas=True
            )
            
            # Apply Production Optimizations
            if self.device == "cuda":
                logger.info("Applying GPU and memory optimizations to Diffusers pipeline...")
                self.pipeline.to("cuda")
                
                # VRAM optimizations
                try:
                    # Enable xformers or default SDPA memory efficient attention
                    self.pipeline.enable_xformers_memory_efficient_attention()
                    logger.info("Enabled xFormers memory efficient attention.")
                except Exception as e:
                    logger.warning(f"xFormers not available. Using PyTorch SDPA memory efficient attention: {e}")
                
                # Sequential CPU offload saves massive VRAM during multiple controlnets
                # For an RTX 4090, if we have plenty VRAM, we can run without offload for max speed.
                # If memory pressure is low, we enable sequential cpu offload dynamically or use model CPU offload.
                self.pipeline.enable_model_cpu_offload()
                
                # Enable torch compile for maximum RTX 4090 speed
                try:
                    self.pipeline.unet = torch.compile(self.pipeline.unet, mode="reduce-overhead", fullgraph=True)
                    logger.info("Successfully compiled UNet model.")
                except Exception as compile_err:
                    logger.warning(f"UNet compilation not active: {compile_err}")
                
                torch.backends.cuda.matmul.allow_tf32 = True
                torch.backends.cudnn.benchmark = True
                
            logger.info("AI Anime Generation Pipeline initialized successfully.")
            
        except Exception as e:
            logger.error(f"Failed to initialize production Diffusers pipeline: {e}. Running in Fallback/Mock mode.")
            settings.MOCK_INFERENCE = True

    def get_style_prompts(self, style: str) -> Tuple[str, str]:
        """
        Translates stylistic selection into positive and negative prompts.
        """
        # Style templates customized for Animagine XL
        style_templates = {
            "Anime": (
                "anime artwork, digital illustration, vibrant colors, clean lines, highly detailed, masterpieces style", 
                "realistic, 3d render, photo, photorealistic, worst quality"
            ),
            "Studio Ghibli inspired": (
                "studio ghibli style, hand-drawn aesthetic, vintage anime, lush green landscapes, warm soft lighting, nostalgic mood, painted background",
                "neon lighting, high contrast, cyberpunk, 3d, realistic, digital gloss"
            ),
            "Makoto Shinkai inspired": (
                "makoto shinkai style, spectacular sky, detailed clouds, sun rays, lens flare, high dynamic range, hyper-detailed backgrounds, emotional lighting",
                "sketch, monochrome, dark theme, low contrast, vintage"
            ),
            "Cyberpunk": (
                "cyberpunk style, futuristic, neon glowing cables, high contrast, hologram overlays, dark purple and electric blue palette, synthwave illustration",
                "classic watercolor, drawing, sketch, sepia, warm tones"
            ),
            "Watercolor": (
                "watercolor painting, soft fluid washes, ink splatters, textured paper background, pastel colors, artistic illustration, abstract touches",
                "sharp borders, plastic textures, high contrast, neon, dark colors"
            ),
            "Manga": (
                "manga page style, black and white ink illustration, screen tone dots, action lines, dramatic shading, high contrast comic ink work",
                "colored, color illustration, watercolor, photorealistic, smooth shades"
            ),
            "Comic": (
                "retro western comic book art, pop art style, bold outlines, flat colors, ben-day dots texture, vintage halftone shading, superhero aesthetic",
                "photorealistic, soft shading, pastel colors, clean digital gradients"
            ),
            "Oil Painting": (
                "thick oil painting, visible canvas texture, heavy impasto brushstrokes, rich warm colors, dramatic fine art lighting, classical masterpiece style",
                "clean lines, anime style, flat digital art, manga, vector art"
            )
        }
        
        pos_style, neg_style = style_templates.get(style, style_templates["Anime"])
        
        # Merge with default prompts exactly as requested by Issue 4
        default_pos = "(masterpiece, best quality, anime illustration, professional artwork, extremely detailed, beautiful eyes, soft lighting, sharp focus, vibrant colors, 8k)"
        default_neg = "(low quality, blurry, text, watermark, duplicate, bad anatomy, extra fingers, poor face, oversaturated)"
        
        final_pos = f"{default_pos}, {pos_style}"
        final_neg = f"{default_neg}, {neg_style}"
        
        return final_pos, final_neg

    def draw_kps(self, image: Image.Image, kps: List[np.ndarray]) -> Image.Image:
        """
        Draw InstantID keypoints for the ControlNet input.
        """
        width, height = image.size
        kps_img = np.zeros((height, width, 3), dtype=np.uint8)
        kps = np.array(kps)
        
        # Connect keypoints representing facial structures
        for kid in range(kps.shape[0]):
            x, y = int(kps[kid][0]), int(kps[kid][1])
            # Draw standard keypoints as circles
            cv2.circle(kps_img, (x, y), 5, (0, 0, 255), -1)
            
        return Image.fromarray(kps_img)

    def generate_anime(self, face_aligned_bgr: np.ndarray, style: str) -> Image.Image:
        """
        Runs Animagine XL + InstantID inference.
        """
        if self.pipeline is None:
            raise RuntimeError("Diffusers pipeline is not initialized.")

        # Convert aligned face (BGR) to RGB PIL Image
        face_rgb = cv2.cvtColor(face_aligned_bgr, cv2.COLOR_BGR2RGB)
        pil_face = Image.fromarray(face_rgb)
        
        # 1. Extract Face Landmarks and Embeds
        faces = self.face_app.get(face_aligned_bgr)
        if len(faces) == 0:
            logger.warning("No faces detected by InsightFace in the aligned crop. Using default embeddings.")
            raise ValueError("InsightFace could not detect a face in the input.")
            
        # Get largest face
        face_info = sorted(faces, key=lambda x: (x.bbox[2]-x.bbox[0])*(x.bbox[3]-x.bbox[1]), reverse=True)[0]
        face_emb = face_info.embedding
        face_kps = face_info.kps
        
        # 2. Draw landmarks (Keypoints) to feed ControlNet
        kps_image = self.draw_kps(pil_face, face_kps)
        
        # 3. Get positive and negative prompt additions for the style
        pos_prompt, neg_prompt = self.get_style_prompts(style)
        
        logger.info(f"Running SDXL Animagine XL + InstantID inference on {self.device}...")
        
        # Run inference in FP16 inference mode
        with torch.inference_mode():
            generator = torch.Generator(device=self.device).manual_seed(42) # fixed seed for consistency
            
            output = self.pipeline(
                prompt=pos_prompt,
                negative_prompt=neg_prompt,
                image_embeds=face_emb,
                image=kps_image,
                controlnet_conditioning_scale=0.8,
                guidance_scale=7.5,
                num_inference_steps=30,
                generator=generator
            )
            
        logger.info("SDXL generation completed.")
        return output.images[0]
