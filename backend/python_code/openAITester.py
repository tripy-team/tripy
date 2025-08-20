from openai import OpenAI
from dotenv import load_dotenv
import os


def tester():
    load_dotenv()
    client = OpenAI(api_key=os.getenv("OPENAI_ADMIN_KEY"))
    response = client.chat.completions.create(
        model="gpt-5",
        messages=[
            {"roles": "system", "content": "You're a helpful assistant"},
            {
                "role": "user",
                "content": "write a limerick about the Python programming language",
            },
        ],
    )
    print(response.choices[0].message.content)


if __name__ == "__main__":
    tester()
