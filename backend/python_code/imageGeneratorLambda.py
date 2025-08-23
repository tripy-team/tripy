from openai import OpenAI
from dotenv import load_dotenv
from pydantic import BaseModel
import os


class ImageReq(BaseModel):
    pass


def generate_image(city, country):
    load_dotenv()
    client = OpenAI(api_key=os.getenv("OPENAI_ADMIN_KEY"))

    response = client.images.generate(
        model="gpt-image-1",
        prompt=f"You are a travel agent photographer, with high quality pictures of every city. Generate a picture of {city}, {country}",
        size="12x12",
    )

    return
